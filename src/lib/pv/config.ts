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

/**
 * Durée RÉSERVÉE dans l'agenda, en minutes.
 *
 * Délibérément plus longue que les 15 minutes annoncées au directeur : on
 * promet un rendez-vous court — c'est ce qui le fait accepter — et on se garde
 * la marge pour une démo qui s'étire, une question de fin, ou simplement le
 * temps de souffler avant la suivante. Le consultant n'est donc jamais en
 * retard sur son créneau suivant.
 *
 * Ce réglage ne touche QUE la mécanique : l'événement d'agenda, l'invitation
 * .ics et le pas de la grille de créneaux. Les « 15 min » écrits sur la page et
 * dans les mails sont éditoriaux — ils vivent dans src/pv-assets/ et dans
 * src/lib/pv/notifications.ts, et ne suivent pas cette valeur.
 */
export function pvDurationMin(): number {
  return num('PV_DEMO_DURATION_MIN', 30, 5, 120);
}

/**
 * Pas de la grille de créneaux, en minutes.
 *
 * Aligné par défaut sur la durée réservée : les créneaux proposés se suivent
 * sans trou (9 h, 9 h 30, 10 h…), et c'est la réservation elle-même qui porte
 * la marge, puisqu'elle bloque 30 minutes pour une démo de 15. L'élargir
 * (45, 60) espace davantage les rendez-vous.
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

/**
 * Numéro affiché sur la page (« Si vous avez des questions, appelez Hugo au… »),
 * en chiffres seulement. Le formatage (espaces, +33) est fait à l'affichage.
 */
export function pvConsultantPhone(): string {
  return (process.env.PV_CONSULTANT_PHONE || '0769719845').replace(/[^\d+]/g, '');
}

/** « 07 69 71 98 45 » — pour l'œil. */
export function formatPhoneFr(digits: string): string {
  const d = digits.replace(/\D/g, '');
  const national = d.length === 11 && d.startsWith('33') ? `0${d.slice(2)}` : d;
  return national.length === 10 ? national.replace(/(\d{2})(?=\d)/g, '$1 ') : digits;
}

/** « +33769719845 » — pour le lien tel:. */
export function phoneHref(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('0')) return `tel:+33${d.slice(1)}`;
  if (d.length === 11 && d.startsWith('33')) return `tel:+${d}`;
  return `tel:${d}`;
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
