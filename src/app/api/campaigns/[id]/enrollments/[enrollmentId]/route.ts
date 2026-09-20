// src/app/api/campaigns/[id]/enrollments/[enrollmentId]/route.ts
//
//   GET    /api/campaigns/<id>/enrollments/<enrollmentId>  → l'historique du
//          lead DANS cette campagne : chaque email parti avec son état
//          (envoyé, ouvert, répondu, en échec), les étapes à venir, les
//          réponses reçues et les événements de la frise liés à la campagne
//   PATCH  /api/campaigns/<id>/enrollments/<enrollmentId>  { action }
//   DELETE  …  ?userName=…                                → retire le lead de la campagne
//            (son inscription seulement : le lead reste dans la liste générale)
//
// C'est ici que se joue le traitement lead par lead demandé pour l'outil :
// mettre en pause, reprendre, arrêter ou retirer UN lead ne change rien aux
// autres, ni à l'état de la campagne.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { nextOpenSlot } from '@/lib/campaigns/schedule';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string; enrollmentId: string } }) {
  const enrollment = await prisma.campaignEnrollment.findFirst({
    where: { id: params.enrollmentId, campaignId: params.id },
    include: {
      lead: { select: { id: true, email: true, civility: true, firstName: true, lastName: true, company: true, status: true } },
      mailbox: { select: { email: true } },
      campaign: {
        select: {
          id: true, name: true, status: true,
          steps: { orderBy: { position: 'asc' }, select: { id: true, position: true, subject: true, delayHours: true } },
        },
      },
      messages: {
        orderBy: { sentAt: 'asc' },
        select: {
          id: true, stepId: true, stepPosition: true, variantKey: true, status: true, subject: true,
          toAddress: true, fromAddress: true, sentAt: true,
          openedAt: true, openCount: true, repliedAt: true, error: true,
        },
      },
    },
  });
  if (!enrollment) return NextResponse.json({ error: 'Inscription introuvable' }, { status: 404 });

  const since = enrollment.startedAt ?? enrollment.createdAt;
  const [replies, events] = await Promise.all([
    // Les réponses du lead depuis son inscription : celles rattachées à la
    // campagne, et celles arrivées sans rattachement (ancien relevé) mais
    // après le premier envoi — elles concernent presque toujours ce fil.
    prisma.campaignReply.findMany({
      where: {
        leadId: enrollment.leadId,
        OR: [{ campaignId: params.id }, { campaignId: null, receivedAt: { gte: since } }],
      },
      orderBy: { receivedAt: 'asc' },
      take: 20,
      select: { id: true, subject: true, snippet: true, receivedAt: true, fromAddress: true },
    }),
    prisma.leadEvent.findMany({
      where: { leadId: enrollment.leadId, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, type: true, label: true, userName: true, createdAt: true, payload: true },
    }),
  ]);

  // Ne garder que ce qui parle de CETTE campagne : les événements qui la
  // nomment, et ceux sans campagne (réponse, rebond) survenus pendant la
  // séquence, qui en découlent. Les envois sont déjà dans `messages`.
  const campaignEvents = events.filter(event => {
    if (event.type === 'email_sent' || event.type === 'email_opened') return false;
    const payload = event.payload as { campaignId?: string } | null;
    if (payload?.campaignId) return payload.campaignId === params.id;
    return ['replied', 'bounced', 'unsubscribed', 'stopped'].includes(event.type);
  }).map(({ payload: _payload, ...event }) => event);

  return NextResponse.json({ enrollment, replies, events: campaignEvents });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; enrollmentId: string } }) {
  const enrollment = await prisma.campaignEnrollment.findFirst({
    where: { id: params.enrollmentId, campaignId: params.id },
    include: { mailbox: true, lead: { select: { id: true } } },
  });
  if (!enrollment) return NextResponse.json({ error: 'Inscription introuvable' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || '');
  const userName = body?.userName ? String(body.userName).trim() : null;

  let data: Record<string, unknown>;
  let label: string;

  switch (action) {
    case 'pause':
      data = { status: 'paused' };
      label = 'Séquence mise en pause pour ce lead';
      break;

    case 'resume': {
      if (!enrollment.mailbox) {
        return NextResponse.json({ error: "Ce lead n'a plus de boîte d'envoi affectée." }, { status: 422 });
      }
      // Reprise : prochain envoi au premier créneau ouvert de sa boîte.
      data = { status: 'active', stopReason: null, finishedAt: null, nextSendAt: nextOpenSlot(enrollment.mailbox, new Date()) };
      label = 'Séquence reprise pour ce lead';
      break;
    }

    case 'stop':
      data = { status: 'stopped', stopReason: 'manual', nextSendAt: null, finishedAt: new Date() };
      label = 'Séquence arrêtée manuellement pour ce lead';
      break;

    default:
      return NextResponse.json({ error: 'Action inconnue (pause, resume, stop)' }, { status: 400 });
  }

  const updated = await prisma.campaignEnrollment.update({ where: { id: enrollment.id }, data });
  await prisma.leadEvent.create({
    data: { leadId: enrollment.leadId, type: 'stopped', label, userName, payload: { campaignId: params.id, action } },
  });

  return NextResponse.json({ enrollment: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string; enrollmentId: string } }) {
  const enrollment = await prisma.campaignEnrollment.findFirst({
    where: { id: params.enrollmentId, campaignId: params.id },
    select: { id: true, leadId: true, sentSteps: true, campaign: { select: { name: true } } },
  });
  if (!enrollment) return NextResponse.json({ error: 'Inscription introuvable' }, { status: 404 });

  const userName = req.nextUrl.searchParams.get('userName')?.trim() || null;

  // Retirer un lead d'une campagne ne supprime QUE son inscription : le lead
  // reste dans la liste générale, avec ses notes, ses réponses et sa frise.
  // Les messages déjà envoyés partent avec l'inscription (Cascade) : c'est
  // voulu, « retirer » efface la trace de ce lead dans CETTE campagne. On
  // garde donc une ligne dans la frise du lead pour que le retrait reste
  // lisible depuis sa fiche.
  await prisma.$transaction([
    prisma.campaignEnrollment.delete({ where: { id: enrollment.id } }),
    prisma.leadEvent.create({
      data: {
        leadId: enrollment.leadId,
        type: 'stopped',
        label: `Retiré de la campagne « ${enrollment.campaign.name} »`,
        userName,
        payload: { campaignId: params.id, action: 'remove', sentSteps: enrollment.sentSteps },
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
