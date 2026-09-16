// src/lib/campaigns/schedule.ts
//
// Fenêtres d'envoi et quotas d'une boîte, dans SON fuseau horaire.
//
// Pourquoi ce détour : le serveur tourne en UTC, mais « n'envoyer qu'entre 8 h
// et 19 h, du lundi au vendredi » s'entend à l'heure de Paris. Tout passe donc
// par Intl, seule source de vérité qui tienne compte de l'heure d'été.

import type { Mailbox } from '@prisma/client';

/** Champs d'une boîte dont dépendent la fenêtre et le quota. */
export type ScheduleSettings = Pick<Mailbox,
  'timezone' | 'sendStartHour' | 'sendEndHour' | 'sendDays' |
  'dailyLimit' | 'warmupStart' | 'warmupStep' | 'warmupStartedAt'>;

/** Décalage du fuseau par rapport à UTC, à cet instant précis (en ms). */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map(part => [part.type, part.value]),
  ) as Record<string, string>;

  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return asUtc - date.getTime();
}

/** Heure locale (0–23) et jour ISO (1 = lundi) d'un instant, dans un fuseau. */
export function localParts(date: Date, timeZone: string): { hour: number; isoDay: number } {
  const offset = zoneOffsetMs(date, timeZone);
  const local = new Date(date.getTime() + offset);
  // getUTC* sur une date décalée = heure locale du fuseau visé.
  const jsDay = local.getUTCDay();           // 0 = dimanche
  return { hour: local.getUTCHours(), isoDay: jsDay === 0 ? 7 : jsDay };
}

/** Minuit local du jour en cours, exprimé en instant réel (UTC). */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const offset = zoneOffsetMs(date, timeZone);
  const local = new Date(date.getTime() + offset);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - offset);
}

/** La boîte est-elle dans sa plage d'envoi (jour ET heure) ? */
export function isSendWindowOpen(mailbox: ScheduleSettings, now: Date = new Date()): boolean {
  const timezone = mailbox.timezone || 'Europe/Paris';
  const { hour, isoDay } = localParts(now, timezone);

  const days = mailbox.sendDays.split(',').map(Number).filter(Boolean);
  if (days.length && !days.includes(isoDay)) return false;

  const start = mailbox.sendStartHour;
  const end = mailbox.sendEndHour;
  // Plage « à cheval sur minuit » (22 h → 6 h) : les deux moitiés comptent.
  if (end <= start) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

/**
 * Plafond du jour, montée en charge comprise.
 * Sans montée en charge (warmupStart = 0), c'est simplement le quota réglé.
 */
export function dailyCap(mailbox: ScheduleSettings, now: Date = new Date()): number {
  if (!mailbox.warmupStart || !mailbox.warmupStartedAt) return mailbox.dailyLimit;

  const timezone = mailbox.timezone || 'Europe/Paris';
  const days = Math.floor(
    (startOfLocalDay(now, timezone).getTime()
      - startOfLocalDay(mailbox.warmupStartedAt, timezone).getTime()) / 86_400_000,
  );
  const cap = mailbox.warmupStart + Math.max(0, days) * mailbox.warmupStep;
  return Math.max(1, Math.min(mailbox.dailyLimit, cap));
}

/** Délai aléatoire avant le prochain envoi de cette boîte, en millisecondes. */
export function randomDelayMs(mailbox: Pick<Mailbox, 'minDelaySec' | 'maxDelaySec'>): number {
  const min = Math.max(0, mailbox.minDelaySec);
  const max = Math.max(min, mailbox.maxDelaySec);
  return (min + Math.random() * (max - min)) * 1000;
}

/**
 * Prochaine ouverture de la fenêtre d'envoi, à partir d'un instant donné.
 * Utilisé pour programmer une étape qui tomberait en pleine nuit : on la cale
 * au premier créneau autorisé plutôt que de la laisser partir à 3 h du matin.
 */
export function nextOpenSlot(mailbox: ScheduleSettings, from: Date): Date {
  const timezone = mailbox.timezone || 'Europe/Paris';
  const candidate = new Date(from);
  // Recherche heure par heure sur deux semaines : suffisant même si la boîte
  // n'envoie qu'un seul jour par semaine, et borné en toutes circonstances.
  for (let i = 0; i < 24 * 14; i++) {
    if (isSendWindowOpen(mailbox, candidate)) {
      // Première heure ouverte : on garde les minutes d'origine si l'on est
      // déjà dans la fenêtre, sinon on démarre au début de l'heure.
      return i === 0 ? candidate : new Date(Math.floor(candidate.getTime() / 3_600_000) * 3_600_000);
    }
    candidate.setTime(candidate.getTime() + 3_600_000);
  }
  // Aucune fenêtre trouvée (réglage incohérent) : on rend l'heure demandée.
  void timezone;
  return from;
}
