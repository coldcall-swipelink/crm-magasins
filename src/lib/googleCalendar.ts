// src/lib/googleCalendar.ts
//
// Intégration Google Calendar + Google Meet.
//
// Quand une affaire passe dans la colonne « Démo prévue », on crée (ou met à
// jour) un événement Google Calendar avec une visioconférence Google Meet
// « Ouverte à tous » (accessType = OPEN) et on invite le contact de l'affaire
// ainsi que bilal@swipelink.fr.
//
// Authentification : OAuth2 « installé » avec refresh token. On échange le
// refresh token contre un access token à chaque appel (les access tokens
// Google durent ~1h, inutile de les mettre en cache pour notre usage).
//
// Variables d'environnement requises (voir .env.example) :
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_REFRESH_TOKEN
// Optionnelles :
//   GOOGLE_CALENDAR_ID        (défaut : "primary")
//   GOOGLE_MEET_GUEST_EMAIL   (défaut : "bilal@swipelink.fr")
//   GOOGLE_MEET_DURATION_MIN  (défaut : 30)
//   GOOGLE_MEET_TIMEZONE      (défaut : "Europe/Paris")

import { prisma } from '@/lib/prisma';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MEET_SPACES_URL = 'https://meet.googleapis.com/v2/spaces';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

const DEFAULT_GUEST = 'bilal@swipelink.fr';
const DEFAULT_DURATION_MIN = 30;
const DEFAULT_TIMEZONE = 'Europe/Paris';

/** Indique si l'intégration est configurée. Sinon on no-op silencieusement. */
export function isGoogleCalendarConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN,
  );
}

/** Échange le refresh token contre un access token. */
async function getAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID as string,
    client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN as string,
    grant_type: 'refresh_token',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Échec du refresh du token Google (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('Réponse OAuth Google sans access_token');
  return data.access_token;
}

/**
 * Crée un espace Google Meet « Ouvert à tous » (accessType = OPEN) via l'API
 * Google Meet v2 et renvoie l'URL + le code de la réunion.
 */
async function createOpenMeetSpace(
  accessToken: string,
): Promise<{ meetingUri: string; meetingCode: string }> {
  const res = await fetch(MEET_SPACES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ config: { accessType: 'OPEN' } }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Échec de création de l'espace Meet (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as { meetingUri?: string; meetingCode?: string };
  if (!data.meetingUri || !data.meetingCode) {
    throw new Error('Réponse Meet sans meetingUri/meetingCode');
  }
  return { meetingUri: data.meetingUri, meetingCode: data.meetingCode };
}

interface DemoEventInput {
  summary: string;
  startIso: string;
  endIso: string;
  timeZone: string;
  attendees: string[];
  // Si un espace Meet « Ouvert à tous » a pu être créé en amont, on l'attache
  // directement. Sinon (typique compte gmail non-Workspace), on laisse Google
  // Calendar générer le Meet via createRequest.
  meetingUri?: string;
  meetingCode?: string;
  requestId?: string;
}

function buildEventBody(input: DemoEventInput) {
  const hasSpace = Boolean(input.meetingUri && input.meetingCode);
  const conferenceData = hasSpace
    ? {
        conferenceId: input.meetingCode,
        conferenceSolution: { key: { type: 'hangoutsMeet' }, name: 'Google Meet' },
        entryPoints: [
          {
            entryPointType: 'video',
            uri: input.meetingUri,
            label: (input.meetingUri as string).replace(/^https?:\/\//, ''),
          },
        ],
      }
    : {
        // Repli : Google Calendar crée le Meet lui-même (marche sur gmail perso).
        createRequest: {
          requestId: input.requestId || `demo-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };

  return {
    summary: input.summary,
    description: hasSpace
      ? `Démo Swipelink — recrutements.\n\nLien Google Meet : ${input.meetingUri}`
      : 'Démo Swipelink — recrutements.',
    ...(hasSpace ? { location: input.meetingUri } : {}),
    start: { dateTime: input.startIso, timeZone: input.timeZone },
    end: { dateTime: input.endIso, timeZone: input.timeZone },
    attendees: input.attendees.map((email) => ({ email })),
    guestsCanInviteOthers: true,
    conferenceData,
  };
}

/** Extrait l'URL du Meet depuis la réponse d'un événement Calendar. */
function extractMeetUrl(event: CalendarEvent): string {
  if (event?.hangoutLink) return event.hangoutLink;
  const ep = event?.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
  return ep?.uri || '';
}

interface CalendarEvent {
  id: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}

async function insertCalendarEvent(
  accessToken: string,
  calendarId: string,
  body: ReturnType<typeof buildEventBody>,
): Promise<CalendarEvent> {
  const url =
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events` +
    `?conferenceDataVersion=1&sendUpdates=all`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Échec de création de l'événement (${res.status}): ${detail}`);
  }
  return (await res.json()) as CalendarEvent;
}

async function patchCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: ReturnType<typeof buildEventBody>,
): Promise<CalendarEvent> {
  const url =
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}` +
    `?conferenceDataVersion=1&sendUpdates=all`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Échec de mise à jour de l'événement (${res.status}): ${detail}`);
  }
  return (await res.json()) as CalendarEvent;
}

/** Convertit une Date en chaîne RFC3339 « locale » (sans le suffixe Z) pour le fuseau donné. */
function toZonedRfc3339(date: Date, timeZone: string): string {
  // On extrait les composantes date/heure telles qu'affichées dans le fuseau
  // cible, et on laisse Google appliquer le timeZone fourni à côté.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Synchronise l'événement « Démo prévue » d'une affaire avec Google Calendar.
 *
 * - Ne fait rien si l'intégration n'est pas configurée.
 * - Ne fait rien si l'affaire n'est pas dans la colonne « Démo prévue » ou si
 *   aucune date de démo n'est renseignée.
 * - Crée l'événement + l'espace Meet la première fois, le met à jour ensuite.
 *
 * Cette fonction n'échoue jamais bruyamment : toute erreur est loggée et
 * renvoyée pour information, mais ne doit pas casser le déplacement d'affaire.
 */
export async function syncDemoMeeting(
  dealId: string,
  pvChoice?: 'oui' | 'non',
): Promise<{ ok: boolean; reason?: string; meetUrl?: string }> {
  if (!isGoogleCalendarConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { store: { include: { brand: true } }, column: true },
  });

  if (!deal) return { ok: false, reason: 'deal_not_found' };
  if (deal.column?.title !== 'Démo prévue') return { ok: false, reason: 'wrong_column' };
  if (!deal.demoDate) return { ok: false, reason: 'no_demo_date' };

  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  const timeZone = process.env.GOOGLE_MEET_TIMEZONE || DEFAULT_TIMEZONE;
  const guestEmail = process.env.GOOGLE_MEET_GUEST_EMAIL || DEFAULT_GUEST;
  const durationMin = Number(process.env.GOOGLE_MEET_DURATION_MIN) || DEFAULT_DURATION_MIN;

  // Titre de l'invitation.
  // - Prospection de Valeur OUI (ou choix non précisé) : titre par défaut
  //   « Swipelink & (enseigne) (localisation) - Recrutements ».
  // - Prospection de Valeur NON : « Présentation Swipelink - (enseigne) (ville) ».
  const enseigne = deal.store.brand?.name?.trim() || deal.store.name?.trim() || '';
  const localisation =
    deal.store.city?.trim() || deal.store.department?.trim() || deal.store.postalCode?.trim() || '';
  const summary = (
    pvChoice === 'non'
      ? `Présentation Swipelink - ${enseigne} ${localisation}`
      : `Swipelink & ${enseigne} ${localisation} - Recrutements`
  )
    .replace(/\s+/g, ' ')
    .trim();

  // Invités : contact de l'affaire (si email valide) + bilal@swipelink.fr.
  const attendees: string[] = [];
  const contactEmail = deal.dealEmail?.trim();
  if (contactEmail && contactEmail.includes('@')) attendees.push(contactEmail);
  if (!attendees.includes(guestEmail)) attendees.push(guestEmail);

  const start = new Date(deal.demoDate);
  const end = new Date(start.getTime() + durationMin * 60 * 1000);

  try {
    const accessToken = await getAccessToken();

    // On (ré)utilise le lien Meet existant si on en a déjà créé un. Sinon, on
    // tente un espace Meet « Ouvert à tous » (accessType OPEN). Si l'API Meet
    // refuse (fréquent sur un compte gmail non-Workspace), on bascule sur un
    // Meet généré directement par Google Calendar : l'invitation part quand même.
    let meetingUri = deal.googleMeetUrl || '';
    let meetingCode = meetingUri ? meetingUri.split('/').pop() || '' : '';
    if (!meetingUri || !meetingCode) {
      try {
        const space = await createOpenMeetSpace(accessToken);
        meetingUri = space.meetingUri;
        meetingCode = space.meetingCode;
      } catch (spaceErr) {
        console.warn('[syncDemoMeeting] espace Meet « Ouvert à tous » impossible, repli sur un Meet généré par Calendar:', spaceErr);
        meetingUri = '';
        meetingCode = '';
      }
    }

    const body = buildEventBody({
      summary,
      startIso: toZonedRfc3339(start, timeZone),
      endIso: toZonedRfc3339(end, timeZone),
      timeZone,
      attendees,
      meetingUri: meetingUri || undefined,
      meetingCode: meetingCode || undefined,
      requestId: `demo-${deal.id}`,
    });

    let eventId = deal.googleEventId || '';
    let eventResp: CalendarEvent;
    if (eventId) {
      try {
        eventResp = await patchCalendarEvent(accessToken, calendarId, eventId, body);
      } catch (patchErr) {
        // L'événement a peut-être été supprimé côté Google : on en recrée un.
        console.warn('[syncDemoMeeting] patch échoué, recréation:', patchErr);
        eventResp = await insertCalendarEvent(accessToken, calendarId, body);
        eventId = eventResp.id;
      }
    } else {
      eventResp = await insertCalendarEvent(accessToken, calendarId, body);
      eventId = eventResp.id;
    }

    // En mode repli, c'est Calendar qui a généré le Meet : on récupère son lien.
    if (!meetingUri) meetingUri = extractMeetUrl(eventResp);

    await prisma.deal.update({
      where: { id: deal.id },
      data: { googleEventId: eventId, googleMeetUrl: meetingUri || null },
    });

    return { ok: true, meetUrl: meetingUri };
  } catch (err) {
    console.error('[syncDemoMeeting] erreur:', err);
    return { ok: false, reason: String(err) };
  }
}
