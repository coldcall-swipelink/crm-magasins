// src/lib/pv/slots.ts
//
// Créneaux proposés au directeur de magasin sur l'écran 4 du parcours.
//
// Trois exigences du pilote, dans l'ordre où elles se voient :
//
//   • RÉELLEMENT LIBRES — la grille est confrontée aux occupations de l'agenda
//     des démos (lues à chaque appel, cf. fetchBusyRanges) ET aux réservations
//     déjà enregistrées côté CRM. Les deux, parce qu'une réservation faite il y
//     a deux secondes peut ne pas encore être visible côté Google.
//
//   • À J+2 MINIMUM — il faut le temps de chasser les deux profils avant la
//     démo. La page applique la même règle de son côté ; le serveur ne s'y fie
//     pas et la réapplique, ici comme à la réservation.
//
//   • SANS CACHE — recalculés à chaque appel. La page recharge toutes les
//     30 secondes : un créneau pris doit disparaître tout de suite, sinon deux
//     directeurs choisissent le même et le second se fait refuser.

import { prisma } from '@/lib/prisma';
import { fetchBusyRanges, fromLocalParts, localParts } from '@/lib/calendarAvailability';
import { isGoogleCalendarConfigured } from '@/lib/googleCalendar';
import {
  pvCalendarId,
  pvDays,
  pvDurationMin,
  pvHours,
  pvMinNoticeH,
  pvSlotStepMin,
  pvTimeZone,
  pvWindowDays,
} from '@/lib/pv/config';

export interface PvSlot {
  start: string;
  end: string;
}

/** Instant à partir duquel un créneau est proposable (délai de prévenance). */
export function earliestBookableAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + pvMinNoticeH() * 3600 * 1000);
}

/**
 * Grille théorique : tous les créneaux de la plage de travail, sur la fenêtre
 * ouverte à la réservation, jours autorisés seulement. Aucune notion
 * d'occupation ici — juste « quand acceptons-nous des démos ».
 */
function buildGrid(now: Date): PvSlot[] {
  const tz = pvTimeZone();
  const { start: startHour, end: endHour } = pvHours();
  const step = pvSlotStepMin();
  const duree = pvDurationMin();
  const jours = pvDays();
  const minT = earliestBookableAt(now).getTime();

  const slots: PvSlot[] = [];
  const depart = localParts(now, tz);

  for (let j = 0; j <= pvWindowDays(); j++) {
    // Midi comme point d'ancrage du jour : aucun changement d'heure ne peut
    // faire basculer la date.
    const midi = fromLocalParts(depart.y, depart.m, depart.d, 12, 0, tz);
    midi.setUTCDate(midi.getUTCDate() + j);
    const jour = localParts(midi, tz);
    // localParts renvoie 0 pour dimanche ; la configuration parle en ISO (7).
    const isoWeekday = jour.weekday === 0 ? 7 : jour.weekday;
    if (!jours.has(isoWeekday)) continue;

    for (let m = startHour * 60; m + duree <= endHour * 60; m += step) {
      const debut = fromLocalParts(jour.y, jour.m, jour.d, Math.floor(m / 60), m % 60, tz);
      if (debut.getTime() < minT) continue;
      const fin = new Date(debut.getTime() + duree * 60000);
      slots.push({ start: debut.toISOString(), end: fin.toISOString() });
    }
  }
  return slots;
}

/** Deux intervalles se chevauchent-ils ? */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Créneaux réellement libres, prêts à être renvoyés par GET /api/pv/slots.
 *
 * Si l'agenda Google n'est pas joignable, on n'invente pas des disponibilités :
 * mieux vaut une liste vide (« aucun créneau pour le moment », et le bouton
 * « être rappelé » juste en dessous) qu'un rendez-vous posé sur une plage déjà
 * occupée. Les réservations du CRM, elles, restent toujours prises en compte.
 */
export async function listFreeSlots(now: Date = new Date()): Promise<PvSlot[]> {
  const grid = buildGrid(now);
  if (grid.length === 0) return [];

  const timeMin = new Date(grid[0].start);
  const timeMax = new Date(grid[grid.length - 1].end);

  const reservations = await prisma.pvBooking.findMany({
    where: { status: 'booked', startAt: { gte: timeMin, lte: timeMax } },
    select: { startAt: true, endAt: true },
  });

  let busy: Array<{ start: number; end: number }> = reservations.map(r => ({
    start: r.startAt.getTime(),
    end: r.endAt.getTime(),
  }));

  if (isGoogleCalendarConfigured()) {
    try {
      const plages = await fetchBusyRanges(timeMin, timeMax, pvCalendarId());
      busy = busy.concat(
        plages.map(p => ({ start: new Date(p.start).getTime(), end: new Date(p.end).getTime() })),
      );
    } catch (err) {
      console.error('[pv/slots] agenda illisible :', err);
      return [];
    }
  }

  return grid.filter(slot => {
    const s = new Date(slot.start).getTime();
    const e = new Date(slot.end).getTime();
    return !busy.some(b => overlaps(s, e, b.start, b.end));
  });
}

/**
 * Le créneau demandé fait-il bien partie de la grille (bon pas horaire, bonne
 * plage, bon délai) ? Vérifié à la réservation : le corps d'une requête POST
 * n'est jamais que ce que le navigateur a bien voulu envoyer.
 */
export function isSlotOnGrid(startIso: string, now: Date = new Date()): boolean {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return false;
  return buildGrid(now).some(s => s.start === start.toISOString());
}
