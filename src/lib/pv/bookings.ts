// src/lib/pv/bookings.ts
//
// Réservation d'une démo depuis le parcours boucher.
//
// LE POINT DÉLICAT : deux directeurs peuvent cliquer sur le même créneau à la
// même seconde. « Lire les créneaux libres, puis écrire » ne suffit pas — entre
// la lecture et l'écriture, l'autre est passé. C'est donc la BASE qui tranche :
// PvBooking.slotKey porte l'heure de début et est UNIQUE. Le second insert viole
// la contrainte, on le rattrape (code Prisma P2002) et on renvoie 409. Aucune
// fenêtre, aucun verrou applicatif à tenir.
//
// L'ORDRE DES OPÉRATIONS suit ce que l'on peut défaire :
//   1. réservation du créneau en base  — annulable (on supprime la ligne) ;
//   2. création de l'événement Google  — non annulable proprement ;
//   3. mise à jour de l'affaire et des réponses, puis mail de confirmation.
//
// Si Google échoue à l'étape 2, on GARDE la réservation : perdre un rendez-vous
// obtenu de haute lutte parce qu'une API a hoqueté serait absurde. Le créneau
// reste tenu, une note est déposée sur l'affaire pour que quelqu'un envoie le
// lien à la main, et la page confirme sans lien visio (elle sait faire).

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { duplicateDeal, PV_TARGETS } from '@/lib/dealDuplication';
import { recordDealMove } from '@/lib/dealMoves';
import {
  pvConsultant,
  pvDurationMin,
  pvRescheduleUrl,
  pvSenderEmail,
  pvSenderName,
} from '@/lib/pv/config';
import { cancelPvDemoEvent, createPvDemoEvent, isValidEmail, movePvDemoEvent } from '@/lib/pv/calendar';
import { buildDemoIcs } from '@/lib/pv/ics';
import { sendPvMail } from '@/lib/pv/mail';
import { formatCreneau, renderConfirmation } from '@/lib/pv/notifications';
import type { PvInviteWithDeal } from '@/lib/pv/invites';
import { isSlotOnGrid, listFreeSlots } from '@/lib/pv/slots';

/** Colonne d'arrivée de l'affaire une fois la démo posée. */
const CIBLE_DEMO = { pipeline: 'Closing', column: 'DEMO PREVUE' };

export interface BookingPayload {
  experience: string;
  salaire: string;
  salaireType: string;
  priseDePoste: string;
  email: string;
  emailCorrige: boolean;
  slot: { start: string; end: string };
  cguAcceptees: boolean;
  cguAccepteesLe: string;
  source: string;
  poste: string;
}

export type BookingOutcome =
  | { status: 'ok'; start: string; end: string; meetUrl: string }
  | { status: 'conflict' }
  | { status: 'invalid'; message: string };

/** Valide le corps envoyé par la page. Rien n'est tenu pour acquis. */
export function parseBookingPayload(body: unknown): BookingPayload | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Corps de requête invalide' };
  const b = body as Record<string, unknown>;
  const texte = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  const experience = texte(b.experience);
  const salaire = texte(b.salaire);
  const priseDePoste = texte(b.priseDePoste);
  const email = texte(b.email);
  const slot = b.slot as { start?: unknown; end?: unknown } | undefined;

  if (!experience) return { error: 'Expérience manquante' };
  if (!salaire) return { error: 'Salaire manquant' };
  if (!priseDePoste) return { error: 'Date de prise de poste manquante' };
  if (!isValidEmail(email)) return { error: 'Adresse e-mail invalide' };
  if (!slot || typeof slot.start !== 'string' || typeof slot.end !== 'string') {
    return { error: 'Créneau manquant' };
  }
  if (Number.isNaN(new Date(slot.start).getTime())) return { error: 'Créneau invalide' };
  if (b.cguAcceptees !== true) return { error: 'CGU non acceptées' };

  return {
    experience,
    salaire,
    salaireType: texte(b.salaireType),
    priseDePoste,
    email,
    emailCorrige: b.emailCorrige === true,
    slot: { start: slot.start, end: slot.end },
    cguAcceptees: true,
    cguAccepteesLe: texte(b.cguAccepteesLe) || new Date().toISOString(),
    source: texte(b.source) || 'mail-boucher-offert',
    poste: texte(b.poste) || 'Boucher',
  };
}

/** Une violation de la contrainte d'unicité sur slotKey ? */
function isSlotTaken(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    String(err.meta?.target ?? '').includes('slotKey')
  );
}

/**
 * Réserve (ou déplace) la démo d'une invitation.
 *
 * La revérification de disponibilité est double : la grille (bon créneau, délai
 * de prévenance respecté) puis l'agenda réel. La contrainte d'unicité finit le
 * travail pour les deux clics simultanés que ni l'une ni l'autre ne peut voir.
 */
export async function bookPvDemo(
  invite: PvInviteWithDeal,
  payload: BookingPayload,
  /** Jeton en clair : sert à écrire le lien « Déplacer le rendez-vous » dans
   *  l'événement d'agenda et dans l'invitation .ics. */
  token: string,
): Promise<BookingOutcome> {
  const start = new Date(payload.slot.start);
  const end = new Date(start.getTime() + pvDurationMin() * 60000);
  const slotKey = start.toISOString();

  if (!isSlotOnGrid(slotKey)) {
    return { status: 'invalid', message: "Ce créneau n'est pas proposé à la réservation." };
  }

  // Le créneau est-il ENCORE libre côté agenda ? Exigé par le pilote, et utile :
  // la page peut avoir gardé en mémoire une liste vieille de trente secondes.
  const libres = await listFreeSlots();
  if (!libres.some(s => s.start === slotKey)) return { status: 'conflict' };

  const ancienne = invite.booking && invite.booking.status === 'booked' ? invite.booking : null;
  // Rebooker exactement le même créneau : rien à faire, et surtout pas se
  // refuser soi-même sur sa propre contrainte d'unicité.
  if (ancienne && ancienne.slotKey === slotKey) {
    return { status: 'ok', start: slotKey, end: ancienne.endAt.toISOString(), meetUrl: ancienne.meetUrl };
  }

  // ── 1. Le créneau est pris, ou personne ne l'aura ────────────────────────
  let bookingId: string;
  try {
    bookingId = await prisma.$transaction(async tx => {
      if (ancienne) {
        // Déplacement : on libère l'ancien créneau et on prend le nouveau dans
        // la même transaction. Si le nouveau est déjà pris, rien ne bouge —
        // l'ancien rendez-vous tient toujours.
        await tx.pvBooking.update({
          where: { id: ancienne.id },
          data: { slotKey, startAt: start, endAt: end },
        });
        return ancienne.id;
      }
      const cree = await tx.pvBooking.create({
        data: {
          inviteId: invite.id,
          dealId: invite.dealId,
          slotKey,
          startAt: start,
          endAt: end,
          status: 'booked',
        },
      });
      return cree.id;
    });
  } catch (err) {
    if (isSlotTaken(err)) return { status: 'conflict' };
    throw err;
  }

  // ── 2. Agenda + visio ────────────────────────────────────────────────────
  const magasin = libelleMagasin(invite);

  let meetUrl = ancienne?.meetUrl || '';
  let eventId = ancienne?.googleEventId || '';
  let agendaKo = '';
  try {
    const entree = {
      magasin,
      start,
      end,
      attendeeEmail: payload.email,
      rescheduleUrl: pvRescheduleUrl(token),
      requestId: `pv-${bookingId}`,
    };
    const resultat = eventId
      ? await movePvDemoEvent(eventId, entree)
      : await createPvDemoEvent(entree);
    if (resultat.ok) {
      eventId = resultat.eventId;
      meetUrl = resultat.meetUrl || meetUrl;
    } else {
      agendaKo = resultat.reason || 'agenda_indisponible';
    }
  } catch (err) {
    agendaKo = (err as Error).message;
    console.error('[pv/bookings] agenda :', err);
  }

  // ── 3. L'affaire, les réponses, la trace ─────────────────────────────────
  await finaliserReservation({ invite, bookingId, payload, start, eventId, meetUrl, agendaKo, magasin });

  return { status: 'ok', start: slotKey, end: end.toISOString(), meetUrl };
}

/** « E.Leclerc Montpellier Est » — nom affiché partout (agenda, mails, .ics). */
export function libelleMagasin(invite: PvInviteWithDeal): string {
  const store = invite.deal.store;
  const enseigne = store.brand?.name?.trim() || '';
  const nom = store.name?.trim() || '';
  if (!nom) return enseigne || 'votre magasin';
  if (enseigne && !nom.toLowerCase().includes(enseigne.toLowerCase())) return `${enseigne} ${nom}`;
  return nom;
}

interface FinaliseInput {
  invite: PvInviteWithDeal;
  bookingId: string;
  payload: BookingPayload;
  start: Date;
  eventId: string;
  meetUrl: string;
  agendaKo: string;
  magasin: string;
}

/**
 * Tout ce qui suit la prise du créneau : réponses recopiées, affaire déplacée,
 * démo historisée, sourcing lancé, confirmation envoyée.
 *
 * Aucune de ces étapes ne peut reprendre le créneau au directeur : elles sont
 * donc toutes « best-effort » et tracées, jamais bloquantes.
 */
async function finaliserReservation(input: FinaliseInput): Promise<void> {
  const { invite, bookingId, payload, start, eventId, meetUrl, agendaKo, magasin } = input;
  const premiere = !invite.booking;

  const colonne = await prisma.pipelineColumn
    .findFirst({
      where: { title: CIBLE_DEMO.column, pipeline: { name: CIBLE_DEMO.pipeline } },
      select: { id: true, pipelineId: true },
    })
    .catch(() => null);

  try {
    await prisma.$transaction(async tx => {
      await tx.pvBooking.update({
        where: { id: bookingId },
        data: { googleEventId: eventId, meetUrl, status: 'booked' },
      });

      await tx.pvInvite.update({
        where: { id: invite.id },
        data: {
          experience: payload.experience,
          salaire: payload.salaire,
          salaireType: payload.salaireType,
          priseDePoste: payload.priseDePoste,
          email: payload.email,
          emailCorrected: payload.emailCorrige,
          cguAcceptedAt: new Date(payload.cguAccepteesLe),
        },
      });

      await tx.deal.update({
        where: { id: invite.dealId },
        data: {
          isPV: true,
          dealEmail: payload.email,
          demoDate: start,
          demoBookedAt: new Date(),
          pvExperience: payload.experience,
          pvSalaire: payload.salaire,
          pvPriseDePoste: payload.priseDePoste,
          pvEmailValidatedAt: new Date(),
          pvCguAcceptedAt: new Date(payload.cguAccepteesLe),
          googleEventId: eventId || undefined,
          googleMeetUrl: meetUrl || undefined,
          ...(colonne ? { columnId: colonne.id, pipelineId: colonne.pipelineId } : {}),
        },
      });

      // Historique des démos, comme pour un booking fait à la main depuis le
      // CRM (markDemoBookedIfNeeded ne s'applique pas ici : personne n'a déplacé
      // de carte, c'est le magasin qui a réservé).
      await tx.demoBooking.create({
        data: {
          dealId: invite.dealId,
          userName: 'Parcours boucher',
          bookedAt: new Date(),
          demoDate: start,
        },
      });

      await tx.note.create({
        data: {
          dealId: invite.dealId,
          content:
            `Démo réservée par le magasin depuis le parcours « 2 CV de bouchers » : `
            + `${formatCreneau(start)}.\n`
            + `Poste : ${payload.poste} · Expérience : ${payload.experience} · `
            + `Salaire : ${payload.salaire} · Prise de poste : ${payload.priseDePoste}.\n`
            + `E-mail validé : ${payload.email}${payload.emailCorrige ? ' (corrigé par le contact)' : ''}. `
            + `CGU acceptées le ${new Date(payload.cguAccepteesLe).toLocaleString('fr-FR')}.`
            + (agendaKo ? `\n⚠ Visio non créée (${agendaKo}) : envoyer le lien à la main.` : ''),
          authorName: 'Swipelink',
        },
      });
    });

    if (colonne) {
      await recordDealMove({
        dealId: invite.dealId,
        fromColumnId: invite.deal.columnId,
        toColumnId: colonne.id,
        userName: 'Parcours boucher',
        source: 'fiche',
      });
    }
  } catch (err) {
    console.error('[pv/bookings] mise à jour de l’affaire impossible :', err);
  }

  // Sourcing : une seule fois par invitation. Un déplacement de rendez-vous ne
  // doit pas créer une deuxième carte de sourcing pour le même magasin.
  if (premiere) {
    try {
      const dup = await duplicateDeal(invite.dealId, PV_TARGETS.oui);
      if (!dup.ok) console.error('[pv/bookings] duplication sourcing :', dup.message);
    } catch (err) {
      console.error('[pv/bookings] duplication sourcing :', err);
    }
  }
}

/**
 * Mail de confirmation + invitation .ics.
 *
 * Séparé de la réservation : il part APRÈS que la page a reçu sa réponse, pour
 * ne pas faire attendre le directeur derrière un serveur SMTP.
 */
export async function sendBookingConfirmation(
  invite: PvInviteWithDeal,
  token: string,
  start: Date,
  end: Date,
  meetUrl: string,
  sequence = 0,
): Promise<void> {
  const magasin = libelleMagasin(invite);
  const consultant = pvConsultant();
  const email = invite.email || invite.deal.dealEmail;
  if (!isValidEmail(email)) return;

  const { subject, html } = renderConfirmation({
    magasin,
    start,
    meetUrl,
    token,
    consultant: consultant.prenom,
  });

  const ics = buildDemoIcs({
    uid: `pv-${invite.id}@swipelink.fr`,
    start,
    end,
    magasin,
    organizerEmail: pvSenderEmail(),
    organizerName: pvSenderName(),
    attendeeEmail: email,
    meetUrl,
    rescheduleUrl: pvRescheduleUrl(token),
    sequence,
  });

  await sendPvMail({
    to: email,
    subject,
    html,
    text: `Votre démo est confirmée : ${formatCreneau(start)}.`
      + (meetUrl ? `\nLien visio : ${meetUrl}` : '')
      + `\nDéplacer le rendez-vous : ${pvRescheduleUrl(token)}`,
    token,
    dealId: invite.dealId,
    attachments: [
      { filename: 'demo-swipelink.ics', content: ics, contentType: 'text/calendar; charset=utf-8; method=REQUEST' },
    ],
  });
}

/** Annule une réservation et libère son créneau. */
export async function cancelPvBooking(bookingId: string): Promise<void> {
  const booking = await prisma.pvBooking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.status !== 'booked') return;
  await cancelPvDemoEvent(booking.googleEventId);
  await prisma.pvBooking.update({
    where: { id: bookingId },
    // slotKey doit rester unique tout en ne désignant plus aucun créneau.
    data: { status: 'cancelled', slotKey: `libre:${booking.id}` },
  });
}
