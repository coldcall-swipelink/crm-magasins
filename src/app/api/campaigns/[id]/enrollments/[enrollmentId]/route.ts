// src/app/api/campaigns/[id]/enrollments/[enrollmentId]/route.ts
//
//   PATCH  /api/campaigns/<id>/enrollments/<enrollmentId>  { action }
//   DELETE  …                                              → désinscrit le lead
//
// C'est ici que se joue le traitement lead par lead demandé pour l'outil :
// mettre en pause, reprendre ou arrêter UN lead ne change rien aux autres, ni
// à l'état de la campagne.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { nextOpenSlot } from '@/lib/campaigns/schedule';

export const dynamic = 'force-dynamic';

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

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; enrollmentId: string } }) {
  const enrollment = await prisma.campaignEnrollment.findFirst({
    where: { id: params.enrollmentId, campaignId: params.id },
    select: { id: true },
  });
  if (!enrollment) return NextResponse.json({ error: 'Inscription introuvable' }, { status: 404 });

  // Les messages déjà envoyés partent avec l'inscription (Cascade) : c'est
  // voulu, « désinscrire » efface la trace de ce lead dans CETTE campagne.
  await prisma.campaignEnrollment.delete({ where: { id: enrollment.id } });
  return NextResponse.json({ ok: true });
}
