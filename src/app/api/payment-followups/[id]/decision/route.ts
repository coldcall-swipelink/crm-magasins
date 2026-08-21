// src/app/api/payment-followups/[id]/decision/route.ts
//
// Décision humaine sur une relance « lien de paiement » : « Relancer » envoie
// le mail au contact de l'affaire, « Ne pas relancer » classe la relance sans
// rien envoyer. Aucun envoi n'a lieu ailleurs — c'est le seul chemin.
//
// Deux garde-fous :
//   - seuls les relecteurs (Hugo Abdelhadi, Bilal Yacouti) peuvent trancher ;
//   - la relance est « réservée » par une mise à jour conditionnelle avant
//     l'envoi : si les deux valident en même temps, le second reçoit un 409
//     avec la décision déjà prise (et le nom de son auteur), pas un doublon.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendCrmEmail } from '@/lib/email';
import {
  followUpRecipient,
  getPaymentFollowUpSettings,
  isFollowUpReviewer,
  renderFollowUpEmail,
} from '@/lib/paymentFollowUp';

export const dynamic = 'force-dynamic';

/** Statuts depuis lesquels une décision est encore possible (« error » = à rejouer). */
const DECIDABLE = ['pending', 'error'];

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const payload = await req.json();
    const decision = payload?.decision;
    const userId: string | null = payload?.userId || null;
    const userName: string = payload?.userName || '';

    if (decision !== 'send' && decision !== 'skip') {
      return NextResponse.json({ error: 'decision doit valoir "send" ou "skip"' }, { status: 400 });
    }
    if (!isFollowUpReviewer(userName)) {
      return NextResponse.json({ error: 'Seuls Hugo Abdelhadi et Bilal Yacouti peuvent valider une relance' }, { status: 403 });
    }

    const followUp = await prisma.paymentFollowUp.findUnique({
      where: { id: params.id },
      include: {
        deal: {
          select: {
            id: true, columnId: true, dealEmail: true, contactCivilite: true,
            contactLastName: true, contactCalling: true, directeur: true,
            store: { select: { name: true, city: true, email: true, brand: { select: { name: true } } } },
            jobOffers: { select: { jobTitle: true }, orderBy: { firstSeenAt: 'desc' }, take: 1 },
          },
        },
      },
    });
    if (!followUp) return NextResponse.json({ error: 'Relance introuvable' }, { status: 404 });
    if (!DECIDABLE.includes(followUp.status)) {
      return NextResponse.json(
        { error: 'Relance déjà traitée', followUp: compact(followUp) },
        { status: 409 },
      );
    }

    // L'utilisateur peut être un compte historique absent de la table : on
    // journalise alors la décision au nom seul (jamais d'échec de clé étrangère).
    const linkedUser = userId
      ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
      : null;
    const decider = {
      decidedByUserId: linkedUser?.id ?? null,
      decidedByName: userName,
      decidedAt: new Date(),
    };

    if (decision === 'skip') {
      const claimed = await prisma.paymentFollowUp.updateMany({
        where: { id: params.id, status: { in: DECIDABLE } },
        data: { ...decider, status: 'skipped', errorMessage: '' },
      });
      if (claimed.count === 0) return conflict(params.id);
      return NextResponse.json({ ok: true, followUp: await reload(params.id) });
    }

    // ---- Envoi de la relance -------------------------------------------------
    const settings = await getPaymentFollowUpSettings();
    const to = followUpRecipient(followUp.deal);
    if (!to) {
      return NextResponse.json(
        { error: 'Aucune adresse email sur cette affaire : renseignez-la sur la fiche avant de relancer.' },
        { status: 400 },
      );
    }
    const rendered = renderFollowUpEmail(followUp.deal, settings);
    // Le relecteur peut ajuster le message dans la pop-up ; à défaut, c'est le
    // mail paramétré dans les Paramètres qui part tel quel.
    const subject = typeof payload?.subject === 'string' && payload.subject.trim()
      ? payload.subject : rendered.subject;
    const body = typeof payload?.body === 'string' && payload.body.trim()
      ? payload.body : rendered.body;

    // Réservation AVANT l'envoi : personne d'autre ne peut envoyer le même mail.
    const claimed = await prisma.paymentFollowUp.updateMany({
      where: { id: params.id, status: { in: DECIDABLE } },
      data: { ...decider, status: 'sending', sentTo: to, errorMessage: '' },
    });
    if (claimed.count === 0) return conflict(params.id);

    try {
      const log = await sendCrmEmail({
        dealId: followUp.dealId,
        from: settings.from,
        to,
        subject,
        body,
      });
      await prisma.paymentFollowUp.update({
        where: { id: params.id },
        data: { status: 'sent', emailLogId: log.id, errorMessage: '' },
      });
      return NextResponse.json({ ok: true, followUp: await reload(params.id) });
    } catch (sendErr) {
      // L'envoi a échoué : la relance repasse en « error », donc rejouable
      // depuis la pop-up, avec le motif affiché.
      const message = sendErr instanceof Error ? sendErr.message : String(sendErr);
      await prisma.paymentFollowUp.update({
        where: { id: params.id },
        data: { status: 'error', errorMessage: message.slice(0, 500) },
      });
      console.error('[POST /api/payment-followups/[id]/decision] envoi', sendErr);
      return NextResponse.json({ error: `Échec de l'envoi : ${message}`, followUp: await reload(params.id) }, { status: 502 });
    }
  } catch (err) {
    console.error('[POST /api/payment-followups/[id]/decision]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/** Vue compacte renvoyée au client (état courant de la relance). */
function compact(row: {
  id: string; status: string; decidedByName: string; decidedAt: Date | null;
  sentTo: string; errorMessage: string;
}) {
  return {
    id: row.id,
    status: row.status,
    decidedByName: row.decidedByName,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    sentTo: row.sentTo,
    errorMessage: row.errorMessage,
  };
}

async function reload(id: string) {
  const row = await prisma.paymentFollowUp.findUnique({ where: { id } });
  return row ? compact(row) : null;
}

/** L'autre relecteur a tranché entre-temps : on renvoie sa décision. */
async function conflict(id: string) {
  return NextResponse.json(
    { error: 'Relance déjà traitée', followUp: await reload(id) },
    { status: 409 },
  );
}
