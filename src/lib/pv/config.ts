// src/lib/pv/config.ts
//
// Réglages du pilote « Prospection de Valeur » (parcours boucher).
//
// Tout est lisible par variable d'environnement pour pouvoir ajuster le pilote
// sans redéployer : durée de la démo, plage de créneaux proposés, délai minimum
// de réservation, identité du consultant affiché.

/** Fuseau de travail. Le même que l'agenda des démos. */
export function pvTimeZone(): string {
  return process.env.GOOGLE_MEET_TIMEZONE || 'Europe/Paris';
}

function num(name: string, fallback: number, min: number, max: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

/** Durée d'une démo, en minutes (15 min annoncées sur la page et dans le mail). */
export function pvDurationMin(): number {
  return num('PV_DEMO_DURATION_MIN', 15, 5, 120);
}

/**
 * Pas de la grille de créneaux, en minutes. Plus large que la démo elle-même :
 * une démo de 15 min proposée toutes les 30 min laisse au consultant le temps
 * de souffler entre deux rendez-vous.
 */
export function pvSlotStepMin(): number {
  return num('PV_SLOT_STEP_MIN', 30, 5, 120);
}

/**
 * Délai minimum entre maintenant et le créneau proposé, en heures. 48 h par
 * défaut, comme la page (CONFIG.MIN_NOTICE_H) : le temps de chasser les deux
 * profils avant la démo.
 */
export function pvMinNoticeH(): number {
  return num('PV_MIN_NOTICE_H', 48, 0, 720);
}

/** Profondeur de l'agenda proposé, en jours. */
export function pvWindowDays(): number {
  return num('PV_WINDOW_DAYS', 14, 1, 60);
}

/** Bornes horaires des créneaux proposés (heures locales du fuseau de travail). */
export function pvHours(): { start: number; end: number } {
  const start = num('PV_START_HOUR', 9, 0, 23);
  const end = num('PV_END_HOUR', 18, 1, 24);
  return end > start ? { start, end } : { start: 9, end: 18 };
}

/** Jours ouverts à la réservation, au format ISO (1 = lundi … 7 = dimanche). */
export function pvDays(): Set<number> {
  const raw = process.env.PV_DAYS || '1,2,3,4,5';
  const days = raw.split(',').map(d => Number(d.trim())).filter(d => d >= 1 && d <= 7);
  return new Set(days.length ? days : [1, 2, 3, 4, 5]);
}

/** Validité d'un jeton d'invitation, en jours. */
export function pvTokenTtlDays(): number {
  return num('PV_TOKEN_TTL_DAYS', 30, 1, 365);
}

/** Agenda qui porte les démos du pilote. Par défaut celui déjà connecté au CRM. */
export function pvCalendarId(): string {
  return process.env.PV_CALENDAR_ID || process.env.GOOGLE_CALENDAR_ID || 'primary';
}

/** Base publique de la page du parcours (sans barre oblique finale). */
export function pvPublicBaseUrl(): string {
  const raw = process.env.PV_PUBLIC_URL || 'https://rdv.swipelink.fr';
  return raw.replace(/\/+$/, '');
}

/** URL du parcours pour un jeton donné — celle du bouton du mail. */
export function pvParcoursUrl(token: string): string {
  return `${pvPublicBaseUrl()}/boucher?t=${encodeURIComponent(token)}`;
}

/**
 * Lien « Déplacer le rendez-vous » de l'invitation : la même page, avec le même
 * jeton. Le directeur y choisit un autre créneau ; la réservation existante est
 * déplacée (et son créneau libéré) au lieu d'en créer une seconde.
 */
export function pvRescheduleUrl(token: string): string {
  return `${pvPublicBaseUrl()}/boucher?t=${encodeURIComponent(token)}&replanifier=1`;
}

export function pvUnsubscribeUrl(token: string): string {
  return `${pvPublicBaseUrl()}/desinscription?t=${encodeURIComponent(token)}`;
}

export interface PvConsultant {
  prenom: string;
  role: string;
  photoUrl: string;
}

/**
 * Consultant affiché sur la page de réservation.
 *
 * Figé pour tout le pilote (Hugo, qui signe aussi le mail) : c'est la même
 * personne que le directeur voit dans sa boîte et sur la page, puis en visio.
 * Modifiable par variables d'environnement sans toucher au code.
 */
export function pvConsultant(): PvConsultant {
  return {
    prenom: process.env.PV_CONSULTANT_PRENOM || 'Hugo',
    role: process.env.PV_CONSULTANT_ROLE || 'consultant recrutement',
    photoUrl: process.env.PV_CONSULTANT_PHOTO_URL || '',
  };
}

/** Adresse d'expédition du mail d'invitation (« Hugo, Swipelink »). */
export function pvSenderEmail(): string {
  return (process.env.PV_SENDER_EMAIL || 'hugo@swipelink.fr').trim().toLowerCase();
}

export function pvSenderName(): string {
  return process.env.PV_SENDER_NAME || 'Hugo, Swipelink';
}

/** Adresse mise en copie invisible de l'agenda (le consultant qui anime). */
export function pvGuestEmail(): string {
  return (process.env.PV_GUEST_EMAIL || process.env.GOOGLE_MEET_GUEST_EMAIL || 'hugo@swipelink.fr').trim();
}
