// src/lib/pv/calendar.ts
//
// Écriture dans l'agenda des démos pour le parcours boucher.
//
// On réutilise le compte Google déjà connecté au CRM (même OAuth, même jeton de
// rafraîchissement — cf. src/lib/googleCalendar.ts) mais avec une porte d'entrée
// distincte : les démos du pilote ont leur propre libellé, leur propre durée et
// peuvent vivre sur un agenda dédié (PV_CALENDAR_ID).
//
// Pourquoi ne pas appeler syncDemoMeeting ? Parce qu'elle part d'une AFFAIRE
// déjà posée dans la colonne « Démo prévue » et d'une date déjà écrite sur la
// fiche. Ici, c'est l'inverse : l'événement est créé d'abord, à partir d'un
// créneau choisi par le directeur, et c'est lui qui fait avancer l'affaire.

import { getGoogleAccessToken, isGoogleCalendarConfigured } from '@/lib/googleCalendar';
import { pvCalendarId, pvGuestEmail, pvTimeZone } from '@/lib/pv/config';

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const MEET_SPACES_URL = 'https://meet.googleapis.com/v2/spaces';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Adresse utilisable comme invité Google (une adresse mal formée fait rejeter
 *  tout l'événement, pas seulement l'invité). */
export function isValidEmail(value: string | null | undefined): boolean {
  return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

/** Date → RFC3339 « local », le fuseau étant fourni à côté à Google. */
function toZonedRfc3339(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

async function createOpenMeetSpace(
  accessToken: string,
): Promise<{ meetingUri: string; meetingCode: string } | null> {
  try {
    const res = await fetch(MEET_SPACES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { accessType: 'OPEN' } }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { meetingUri?: string; meetingCode?: string };
    if (!data.meetingUri || !data.meetingCode) return null;
    return { meetingUri: data.meetingUri, meetingCode: data.meetingCode };
  } catch {
    // Compte Gmail non-Workspace, quota, panne : Calendar générera le Meet.
    return null;
  }
}

interface CalendarEvent {
  id: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
}

function extractMeetUrl(event: CalendarEvent): string {
  if (event.hangoutLink) return event.hangoutLink;
  return event.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri || '';
}

export interface PvEventInput {
  /** Libellé du magasin, pour le titre (« Swipelink & E.Leclerc Lunel — 2 CV bouchers »). */
  magasin: string;
  start: Date;
  end: Date;
  /** Adresse validée par le directeur. Ignorée si elle est mal formée. */
  attendeeEmail: string;
  /** Lien « Déplacer le rendez-vous », repris dans la description. */
  rescheduleUrl: string;
  /** Identifiant d'idempotence pour la génération du Meet par Calendar. */
  requestId: string;
}

export interface PvEventResult {
  ok: boolean;
  eventId: string;
  meetUrl: string;
  reason?: string;
}

function buildBody(input: PvEventInput, space: { meetingUri: string; meetingCode: string } | null) {
  const tz = pvTimeZone();
  const attendees: string[] = [];
  if (isValidEmail(input.attendeeEmail)) attendees.push(input.attendeeEmail.trim());
  const guest = pvGuestEmail();
  if (isValidEmail(guest) && !attendees.includes(guest)) attendees.push(guest);

  const lignes = [
    'Démo Swipelink — présentation de vos 2 CV de bouchers (15 min).',
    space ? `Lien visio : ${space.meetingUri}` : '',
    `Déplacer le rendez-vous : ${input.rescheduleUrl}`,
  ].filter(Boolean);

  return {
    summary: `Swipelink & ${input.magasin} — 2 CV de bouchers`.replace(/\s+/g, ' ').trim(),
    description: lignes.join('\n\n'),
    ...(space ? { location: space.meetingUri } : {}),
    start: { dateTime: toZonedRfc3339(input.start, tz), timeZone: tz },
    end: { dateTime: toZonedRfc3339(input.end, tz), timeZone: tz },
    attendees: attendees.map(email => ({ email })),
    guestsCanInviteOthers: true,
    conferenceData: space
      ? {
          conferenceId: space.meetingCode,
          conferenceSolution: { key: { type: 'hangoutsMeet' }, name: 'Google Meet' },
          entryPoints: [
            {
              entryPointType: 'video',
              uri: space.meetingUri,
              label: space.meetingUri.replace(/^https?:\/\//, ''),
            },
          ],
        }
      : {
          createRequest: {
            requestId: input.requestId,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
  };
}

/**
 * Crée l'événement de démo et sa visio.
 *
 * `sendUpdates=all` : Google envoie lui-même l'invitation aux participants. Le
 * CRM envoie en plus son propre mail de confirmation, avec le .ics et le lien
 * de déplacement — les deux ne se gênent pas, et le directeur reçoit au moins
 * une invitation même si l'un des deux chemins tombe en panne.
 */
export async function createPvDemoEvent(input: PvEventInput): Promise<PvEventResult> {
  if (!isGoogleCalendarConfigured()) {
    return { ok: false, eventId: '', meetUrl: '', reason: 'not_configured' };
  }
  const accessToken = await getGoogleAccessToken();
  const space = await createOpenMeetSpace(accessToken);
  const body = buildBody(input, space);

  const url =
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(pvCalendarId())}/events` +
    `?conferenceDataVersion=1&sendUpdates=all`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Création de l'événement impossible (${res.status}) : ${await res.text()}`);
  }
  const event = (await res.json()) as CalendarEvent;
  return {
    ok: true,
    eventId: event.id,
    meetUrl: space?.meetingUri || extractMeetUrl(event),
  };
}

/** Déplace un événement existant (lien « Déplacer le rendez-vous »). */
export async function movePvDemoEvent(
  eventId: string,
  input: PvEventInput,
): Promise<PvEventResult> {
  if (!isGoogleCalendarConfigured()) {
    return { ok: false, eventId, meetUrl: '', reason: 'not_configured' };
  }
  const accessToken = await getGoogleAccessToken();
  const tz = pvTimeZone();
  const url =
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(pvCalendarId())}/events/${encodeURIComponent(eventId)}` +
    `?conferenceDataVersion=1&sendUpdates=all`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start: { dateTime: toZonedRfc3339(input.start, tz), timeZone: tz },
      end: { dateTime: toZonedRfc3339(input.end, tz), timeZone: tz },
    }),
  });
  if (!res.ok) {
    throw new Error(`Déplacement de l'événement impossible (${res.status}) : ${await res.text()}`);
  }
  const event = (await res.json()) as CalendarEvent;
  return { ok: true, eventId: event.id, meetUrl: extractMeetUrl(event) };
}

/** Annule un événement. Ne lève jamais : une annulation ratée ne doit pas
 *  empêcher la réservation qui la remplace. */
export async function cancelPvDemoEvent(eventId: string): Promise<void> {
  if (!eventId || !isGoogleCalendarConfigured()) return;
  try {
    const accessToken = await getGoogleAccessToken();
    await fetch(
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(pvCalendarId())}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
    );
  } catch (err) {
    console.error('[pv/calendar] annulation impossible :', err);
  }
}
