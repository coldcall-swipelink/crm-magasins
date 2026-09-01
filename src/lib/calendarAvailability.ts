// src/lib/calendarAvailability.ts
/**
 * Disponibilités de l'agenda Google, en créneaux de 30 minutes.
 *
 * Sert au bouton « Afficher les dispos » de la fiche affaire : on y voit, sur
 * une semaine, ce qui est libre et ce qui est pris, pour caler une démo sans
 * quitter le CRM.
 *
 * L'agenda interrogé est celui déjà connecté pour les visios Google Meet
 * (GOOGLE_CALENDAR_ID, « primary » par défaut) — cf. src/lib/googleCalendar.ts.
 * Lecture seule : rien n'est écrit dans l'agenda ici.
 *
 * Toute l'arithmétique se fait dans le fuseau de travail (Europe/Paris par
 * défaut) et NON dans celui du serveur, qui tourne en UTC : sans cela, « 9 h »
 * deviendrait 10 h ou 11 h selon la saison.
 */

import { getGoogleAccessToken, isGoogleCalendarConfigured } from '@/lib/googleCalendar';

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

const DEFAULT_TIMEZONE = 'Europe/Paris';
/** Plage de travail affichée, bornes en heures locales. */
const DEFAULT_START_HOUR = 9;
const DEFAULT_END_HOUR = 19;
const SLOT_MIN = 30;

export type Slot = {
  /** Début du créneau, en instant absolu (ISO). */
  start: string;
  end: string;
  /** Libellé local « 09:30 », déjà calculé dans le fuseau de travail. */
  label: string;
  busy: boolean;
  past: boolean;
  /** Titre de l'événement qui occupe le créneau, pour l'infobulle. */
  busyLabel?: string;
};

export type DayAvailability = {
  /** « 2026-09-03 » dans le fuseau de travail. */
  date: string;
  /** « lundi 3 sept. » */
  label: string;
  weekend: boolean;
  slots: Slot[];
};

export type AvailabilityResult = {
  configured: boolean;
  timeZone: string;
  /** Lundi de la semaine renvoyée, « 2026-09-01 ». */
  weekStart: string;
  days: DayAvailability[];
  error?: string;
};

function timeZone(): string {
  return process.env.GOOGLE_MEET_TIMEZONE || DEFAULT_TIMEZONE;
}

function hourBound(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 && v <= 24 ? v : fallback;
}

/**
 * Décalage du fuseau de travail à un instant donné, en minutes (60 pour
 * Europe/Paris en hiver, 120 en été). Déduit de l'écart entre l'heure lue dans
 * ce fuseau et la même lue en UTC : c'est la façon fiable de faire la bascule
 * heure locale ↔ instant absolu sans dépendre du fuseau du serveur.
 */
function offsetMinutes(instant: Date, tz: string): number {
  const lire = (zone: string) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(instant);
    const g = (t: string) => Number(p.find(x => x.type === t)?.value ?? 0);
    // Attention : à minuit, en-US formate l'heure « 24 ».
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  };
  return (lire(tz) - lire('UTC')) / 60000;
}

/** Instant absolu correspondant à une heure LOCALE du fuseau de travail. */
function fromLocalParts(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  // Première approximation en supposant UTC, puis correction par le décalage
  // réellement en vigueur à cet instant-là (gère les changements d'heure).
  const approx = new Date(Date.UTC(y, m - 1, d, h, min));
  const off = offsetMinutes(approx, tz);
  return new Date(approx.getTime() - off * 60000);
}

/** Composantes de date telles que lues dans le fuseau de travail. */
function localParts(instant: Date, tz: string): { y: number; m: number; d: number; weekday: number } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(instant);
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '';
  const jours: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: Number(g('year')), m: Number(g('month')), d: Number(g('day')), weekday: jours[g('weekday')] ?? 0 };
}

/**
 * Plages occupées de l'agenda entre deux instants, lues via la LISTE DES
 * ÉVÉNEMENTS et non via l'API freeBusy.
 *
 * Pourquoi : freeBusy réclame une autorisation OAuth que le jeton du CRM n'a
 * pas (« ACCESS_TOKEN_SCOPE_INSUFFICIENT »), alors que ce même jeton crée déjà
 * des événements — et qui peut écrire peut lire. Passer par events.list évite
 * de refaire tout le parcours de consentement Google.
 *
 * Sont ignorés : les événements annulés, ceux marqués « disponible »
 * (transparency = transparent, typiquement les rappels d'anniversaire), et
 * ceux auxquels on a répondu non.
 */
async function fetchBusy(
  timeMin: Date,
  timeMax: Date,
): Promise<Array<{ start: string; end: string; summary: string }>> {
  const token = await getGoogleAccessToken();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    // Les séries récurrentes sont développées en occurrences datées : sans
    // cela, un point hebdomadaire n'apparaîtrait qu'une fois.
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '2500',
    timeZone: timeZone(),
  });

  const res = await fetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    throw new Error(`Google Calendar (${res.status}) : ${await res.text()}`);
  }

  const data = await res.json() as {
    items?: Array<{
      status?: string;
      summary?: string;
      transparency?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      attendees?: Array<{ self?: boolean; responseStatus?: string }>;
    }>;
  };

  const plages: Array<{ start: string; end: string; summary: string }> = [];
  for (const ev of data.items ?? []) {
    if (ev.status === 'cancelled') continue;
    if (ev.transparency === 'transparent') continue;
    if (ev.attendees?.some(a => a.self && a.responseStatus === 'declined')) continue;

    const summary = ev.summary || '(sans titre)';
    if (ev.start?.dateTime && ev.end?.dateTime) {
      plages.push({ start: ev.start.dateTime, end: ev.end.dateTime, summary });
    } else if (ev.start?.date && ev.end?.date) {
      // Journée entière : les bornes sont des dates nues, à interpréter dans le
      // fuseau de travail. La fin est exclusive côté Google.
      const [y1, m1, d1] = ev.start.date.split('-').map(Number);
      const [y2, m2, d2] = ev.end.date.split('-').map(Number);
      plages.push({
        start: fromLocalParts(y1, m1, d1, 0, 0, timeZone()).toISOString(),
        end: fromLocalParts(y2, m2, d2, 0, 0, timeZone()).toISOString(),
        summary,
      });
    }
  }
  return plages;
}

/**
 * Semaine de disponibilités à partir d'un lundi.
 *
 * `weekStart` est une date locale « YYYY-MM-DD » ; à défaut, la semaine en
 * cours. On renvoie les sept jours : rien n'est masqué, un samedi libre reste
 * un samedi libre — les directeurs de magasin y sont souvent joignables.
 */
export async function getWeekAvailability(weekStart?: string): Promise<AvailabilityResult> {
  const tz = timeZone();

  // Lundi de référence, dans le fuseau de travail.
  const base = weekStart && /^\d{4}-\d{2}-\d{2}$/.test(weekStart)
    ? (() => { const [y, m, d] = weekStart.split('-').map(Number); return fromLocalParts(y, m, d, 12, 0, tz); })()
    : new Date();
  const { y, m, d, weekday } = localParts(base, tz);
  const versLundi = (weekday + 6) % 7;          // dimanche = 6 jours après lundi
  const lundi = fromLocalParts(y, m, d, 12, 0, tz);
  lundi.setUTCDate(lundi.getUTCDate() - versLundi);
  const debutSemaine = localParts(lundi, tz);

  const startHour = hourBound('CALENDAR_START_HOUR', DEFAULT_START_HOUR);
  const endHour = hourBound('CALENDAR_END_HOUR', DEFAULT_END_HOUR);

  const jourISO = (j: number) => {
    const t = fromLocalParts(debutSemaine.y, debutSemaine.m, debutSemaine.d, 12, 0, tz);
    t.setUTCDate(t.getUTCDate() + j);
    return localParts(t, tz);
  };

  const premier = jourISO(0);
  const dernier = jourISO(6);
  const timeMin = fromLocalParts(premier.y, premier.m, premier.d, 0, 0, tz);
  const timeMax = fromLocalParts(dernier.y, dernier.m, dernier.d, 23, 59, tz);

  const resultat: AvailabilityResult = {
    configured: isGoogleCalendarConfigured(),
    timeZone: tz,
    weekStart: `${premier.y}-${String(premier.m).padStart(2, '0')}-${String(premier.d).padStart(2, '0')}`,
    days: [],
  };

  let busy: Array<{ start: number; end: number; summary: string }> = [];
  if (resultat.configured) {
    try {
      busy = (await fetchBusy(timeMin, timeMax)).map(b => ({
        start: new Date(b.start).getTime(),
        end: new Date(b.end).getTime(),
        summary: b.summary,
      }));
    } catch (err) {
      // La grille reste affichée : mieux vaut des créneaux sans occupation
      // qu'un écran vide, à condition de dire que la lecture a échoué.
      resultat.error = err instanceof Error ? err.message : String(err);
    }
  }

  const maintenant = Date.now();
  const nomJour = new Intl.DateTimeFormat('fr-FR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'short' });

  for (let j = 0; j < 7; j++) {
    const jour = jourISO(j);
    const slots: Slot[] = [];

    for (let minutes = startHour * 60; minutes + SLOT_MIN <= endHour * 60; minutes += SLOT_MIN) {
      const h = Math.floor(minutes / 60);
      const min = minutes % 60;
      const debut = fromLocalParts(jour.y, jour.m, jour.d, h, min, tz);
      const fin = new Date(debut.getTime() + SLOT_MIN * 60000);
      const t = debut.getTime();
      // Un créneau est pris dès qu'il chevauche une plage occupée, même
      // partiellement : une réunion de 15 h 10 à 15 h 40 bloque 15 h et 15 h 30.
      const occupant = busy.find(b => t < b.end && fin.getTime() > b.start);
      slots.push({
        start: debut.toISOString(),
        end: fin.toISOString(),
        label: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
        busy: !!occupant,
        past: fin.getTime() <= maintenant,
        ...(occupant ? { busyLabel: occupant.summary } : {}),
      });
    }

    const midi = fromLocalParts(jour.y, jour.m, jour.d, 12, 0, tz);
    resultat.days.push({
      date: `${jour.y}-${String(jour.m).padStart(2, '0')}-${String(jour.d).padStart(2, '0')}`,
      label: nomJour.format(midi),
      weekend: [0, 6].includes(localParts(midi, tz).weekday),
      slots,
    });
  }

  return resultat;
}
