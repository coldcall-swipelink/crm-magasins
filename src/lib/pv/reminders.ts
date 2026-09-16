// src/lib/pv/reminders.ts
//
// Rappels de démo et relance des parcours abandonnés.
//
// Deux passages, appelés par le planificateur (vercel.json) :
//
//   runDemoReminders()  — toutes les 10 minutes. Envoie le rappel de la veille
//                         puis celui d'une heure avant, e-mail ET SMS.
//   runFollowUps()      — une fois par jour. Relance les magasins qui ont
//                         commencé le parcours sans réserver.
//
// REJOUABLE SANS RISQUE : chaque envoi est marqué en base (remindedDayBeforeAt,
// remindedHourBeforeAt, followUpAt) AVANT de partir. Deux passages simultanés,
// ou un passage rejoué après une panne, ne peuvent pas envoyer deux fois le même
// message — ce qui, sur un rappel de rendez-vous, se remarquerait tout de suite.

import { prisma } from '@/lib/prisma';
import { pvConsultant, pvParcoursUrl } from '@/lib/pv/config';
import { inviteToken } from '@/lib/pv/invites';
import { isEncryptionConfigured, encryptSecret } from '@/lib/campaigns/crypto';
import { generatePvToken, hashPvToken } from '@/lib/pv/token';
import { isValidEmail } from '@/lib/pv/calendar';
import { sendPvMail } from '@/lib/pv/mail';
import {
  formatCreneau,
  formatHeure,
  renderFollowUp,
  renderReminderDayBefore,
  renderReminderHourBefore,
} from '@/lib/pv/notifications';
import { sendSms } from '@/lib/pv/sms';
import { libelleMagasin } from '@/lib/pv/bookings';

export interface ReminderReport {
  veille: number;
  heure: number;
  sms: number;
  erreurs: string[];
}

/** Fenêtre de déclenchement, en minutes : la largeur d'un passage du cron. */
const FENETRE_MIN = 20;

/**
 * Le rappel n'a de valeur que s'il arrive AVANT le rendez-vous.
 *
 * Un magasin rappelé pour une démo déjà passée (planificateur en panne toute la
 * nuit, par exemple) reçoit un message absurde : on préfère marquer le rappel
 * comme traité sans l'envoyer.
 */
function estPasse(start: Date): boolean {
  return start.getTime() <= Date.now();
}

/**
 * Le numéro à qui écrire : celui laissé sur le parcours, sinon celui du contact
 * de l'affaire, sinon celui du magasin.
 */
function numero(booking: {
  invite: { callbackPhone: string; deal: { contactPhone: string; store: { phone: string } } };
}): string {
  const i = booking.invite;
  return (i.callbackPhone || i.deal.contactPhone || i.deal.store.phone || '').trim();
}

const inclusions = {
  invite: {
    include: {
      deal: { include: { store: { include: { brand: true } }, column: true, pipeline: true, jobOffers: { take: 1 } } },
      booking: true,
    },
  },
} as const;

/** Rappels de la veille et d'une heure avant. */
export async function runDemoReminders(now: Date = new Date()): Promise<ReminderReport> {
  const rapport: ReminderReport = { veille: 0, heure: 0, sms: 0, erreurs: [] };
  const consultant = pvConsultant();

  // ── Veille : démos qui commencent dans 20 à 28 heures ────────────────────
  const veilleDebut = new Date(now.getTime() + 20 * 3600 * 1000);
  const veilleFin = new Date(now.getTime() + 28 * 3600 * 1000);

  const veille = await prisma.pvBooking.findMany({
    where: {
      status: 'booked',
      remindedDayBeforeAt: null,
      startAt: { gte: veilleDebut, lte: veilleFin },
      invite: { revokedAt: null },
    },
    include: inclusions,
    take: 100,
  });

  for (const booking of veille) {
    // Réservé AVANT l'envoi : deux passages simultanés ne peuvent pas doubler.
    const { count } = await prisma.pvBooking.updateMany({
      where: { id: booking.id, remindedDayBeforeAt: null },
      data: { remindedDayBeforeAt: new Date() },
    });
    if (count === 0) continue;
    if (estPasse(booking.startAt)) continue;

    const invite = booking.invite;
    const magasin = libelleMagasin(invite as never);
    const contexte = {
      magasin,
      start: booking.startAt,
      meetUrl: booking.meetUrl,
      // Le lien « Déplacer le rendez-vous » du rappel : le même jeton que celui
      // déjà envoyé, pour ne pas invalider ce qui est dans l'agenda.
      token: (await usableToken(invite)) || '',
      consultant: consultant.prenom,
    };

    try {
      const email = invite.email || invite.deal.dealEmail;
      if (isValidEmail(email)) {
        const { subject, html } = renderReminderDayBefore(contexte);
        const envoi = await sendPvMail({
          to: email,
          subject,
          html,
          text: `Votre démo Swipelink : ${formatCreneau(booking.startAt)}.`
            + (booking.meetUrl ? `\nLien visio : ${booking.meetUrl}` : ''),
          dealId: invite.dealId,
        });
        // Le compteur dit ce qui est PARTI, pas ce qui a été tenté : c'est lui
        // qu'on regardera pour savoir si les rappels fonctionnent.
        if (envoi.ok) rapport.veille++;
        else rapport.erreurs.push(`veille ${booking.id} : ${envoi.error || 'envoi refusé'}`);
      }

      const sms = await sendSms(
        numero(booking as never),
        `Swipelink : votre démo « 2 CV de bouchers » a lieu demain à ${formatHeure(booking.startAt)}.`
          + (booking.meetUrl ? ` Lien : ${booking.meetUrl}` : ''),
      );
      if (sms.ok) rapport.sms++;
    } catch (err) {
      rapport.erreurs.push(`veille ${booking.id} : ${(err as Error).message}`);
    }
  }

  // ── Une heure avant : démos qui commencent dans 50 à 70 minutes ──────────
  const heureDebut = new Date(now.getTime() + 50 * 60 * 1000);
  const heureFin = new Date(now.getTime() + (60 + FENETRE_MIN) * 60 * 1000);

  const imminentes = await prisma.pvBooking.findMany({
    where: {
      status: 'booked',
      remindedHourBeforeAt: null,
      startAt: { gte: heureDebut, lte: heureFin },
      invite: { revokedAt: null },
    },
    include: inclusions,
    take: 100,
  });

  for (const booking of imminentes) {
    const { count } = await prisma.pvBooking.updateMany({
      where: { id: booking.id, remindedHourBeforeAt: null },
      data: { remindedHourBeforeAt: new Date() },
    });
    if (count === 0) continue;
    if (estPasse(booking.startAt)) continue;

    const invite = booking.invite;
    const contexte = {
      magasin: libelleMagasin(invite as never),
      start: booking.startAt,
      meetUrl: booking.meetUrl,
      token: (await usableToken(invite)) || '',
      consultant: consultant.prenom,
    };

    try {
      const email = invite.email || invite.deal.dealEmail;
      if (isValidEmail(email)) {
        const { subject, html } = renderReminderHourBefore(contexte);
        const envoi = await sendPvMail({
          to: email,
          subject,
          html,
          text: `Votre démo Swipelink est dans 1 h (${formatHeure(booking.startAt)}).`
            + (booking.meetUrl ? `\nLien visio : ${booking.meetUrl}` : ''),
          dealId: invite.dealId,
        });
        if (envoi.ok) rapport.heure++;
        else rapport.erreurs.push(`heure ${booking.id} : ${envoi.error || 'envoi refusé'}`);
      }

      const sms = await sendSms(
        numero(booking as never),
        `Swipelink : votre démo commence dans 1 h (${formatHeure(booking.startAt)}).`
          + (booking.meetUrl ? ` Lien : ${booking.meetUrl}` : ''),
      );
      if (sms.ok) rapport.sms++;
    } catch (err) {
      rapport.erreurs.push(`heure ${booking.id} : ${(err as Error).message}`);
    }
  }

  return rapport;
}

export interface FollowUpReport {
  relances: number;
  erreurs: string[];
}

/**
 * Relance du lendemain, pour les parcours COMMENCÉS et non réservés.
 *
 * Le critère est un événement `answer_1`, `answer_2` ou `answer_3` — une réponse
 * à une question, donc un geste humain. JAMAIS le simple clic sur le lien du
 * mail : les Safe Links de Microsoft ouvrent les liens pour vérifier qu'ils sont
 * sains, ce qui déclencherait une relance pour quelqu'un qui n'a rien lu.
 *
 * Une seule relance par invitation (followUpAt), et jamais si une réservation
 * ou une demande de rappel est arrivée entre-temps.
 */
export async function runFollowUps(now: Date = new Date()): Promise<FollowUpReport> {
  const rapport: FollowUpReport = { relances: 0, erreurs: [] };
  const consultant = pvConsultant();

  // Entre 20 heures et 7 jours après le dernier geste : le lendemain, sans
  // remonter indéfiniment un arriéré si le planificateur est resté muet.
  const plusRecentQue = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const plusAncienQue = new Date(now.getTime() - 20 * 3600 * 1000);

  const candidats = await prisma.pvInvite.findMany({
    where: {
      revokedAt: null,
      followUpAt: null,
      callbackAt: null,
      booking: null,
      expiresAt: { gt: now },
      events: {
        some: {
          event: { in: ['answer_1', 'answer_2', 'answer_3'] },
          createdAt: { gte: plusRecentQue, lte: plusAncienQue },
        },
      },
    },
    include: { deal: { include: { store: { include: { brand: true } } } } },
    take: 100,
  });

  for (const invite of candidats) {
    // Réservée avant envoi, comme les rappels.
    const { count } = await prisma.pvInvite.updateMany({
      where: { id: invite.id, followUpAt: null },
      data: { followUpAt: new Date() },
    });
    if (count === 0) continue;

    const email = invite.email || invite.deal.dealEmail;
    if (!isValidEmail(email)) continue;

    // Le lien de la relance rouvre LA page du magasin, avec ses réponses déjà
    // enregistrées (cf. usableToken plus bas).
    try {
      const lien = await regenerateInviteLink(invite);
      if (!lien) continue;

      const { subject, html } = renderFollowUp({
        magasin: invite.deal.store.name,
        prenom: '',
        nbProfils: invite.nbProfils,
        token: '',
        lien,
        consultant: consultant.prenom,
      });

      const envoi = await sendPvMail({
        to: email,
        subject,
        html,
        text: `Vos réponses sont gardées : choisissez votre créneau — ${lien}`,
        dealId: invite.dealId,
      });
      if (envoi.ok) rapport.relances++;
      else rapport.erreurs.push(`relance ${invite.id} : ${envoi.error || 'envoi refusé'}`);
    } catch (err) {
      rapport.erreurs.push(`relance ${invite.id} : ${(err as Error).message}`);
    }
  }

  return rapport;
}

/**
 * Jeton utilisable pour écrire un lien dans un message.
 *
 * On relit d'abord la copie chiffrée : c'est le MÊME jeton que celui déjà posé
 * dans le mail de confirmation et dans l'invitation d'agenda, qui continuent
 * donc de fonctionner. Ce n'est qu'à défaut (chiffrement non configuré, clé
 * changée) qu'on en émet un neuf — au prix des anciens liens, ce que l'on
 * signale dans les journaux plutôt que de renoncer à l'envoi.
 */
export async function usableToken(invite: { id: string; tokenCipher: string }): Promise<string | null> {
  const existant = inviteToken(invite);
  if (existant) return existant;

  if (!isEncryptionConfigured()) {
    console.warn('[pv/reminders] CAMPAIGN_SECRET_KEY absente : émission d’un nouveau jeton, '
      + 'les liens déjà envoyés pour cette invitation cesseront de fonctionner.');
  }
  const token = generatePvToken();
  const { count } = await prisma.pvInvite.updateMany({
    where: { id: invite.id, revokedAt: null },
    data: {
      tokenHash: hashPvToken(token),
      tokenCipher: isEncryptionConfigured() ? encryptSecret(token) : '',
    },
  });
  return count === 1 ? token : null;
}

/** Lien du parcours pour une invitation existante. */
export async function regenerateInviteLink(invite: {
  id: string;
  tokenCipher: string;
}): Promise<string | null> {
  const token = await usableToken(invite);
  return token ? pvParcoursUrl(token) : null;
}
