// src/app/api/campaigns/[id]/send-now/route.ts
//
//   POST /api/campaigns/<id>/send-now
//
// Fait tourner le moteur tout de suite, sur les boîtes de CETTE campagne.
//
// Pourquoi : le départ des emails ne doit pas dépendre entièrement d'un cron.
// S'il n'est pas configuré, ou limité par l'hébergeur, une campagne peut
// rester muette sans que rien ne l'explique. Ce déclenchement manuel donne à
// l'utilisateur le moyen de faire partir ses emails — et de voir, dans le
// compte rendu, ce qui coince quand rien ne part.
//
// Même moteur, mêmes garde-fous : plage horaire, quota, espacement. « Envoyer
// maintenant » ne veut pas dire « envoyer tout, tout de suite ».

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runDueSends } from '@/lib/campaigns/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, mailboxes: { select: { mailboxId: true } } },
  });
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  if (campaign.status !== 'running') {
    return NextResponse.json({
      error: "La campagne n'est pas en cours : lancez-la d'abord.",
    }, { status: 422 });
  }

  // Budget court : l'utilisateur attend devant son écran. Le reste de la file
  // partira au passage suivant, avec l'espacement habituel.
  const result = await runDueSends({
    budgetMs: 25_000,
    mailboxIds: campaign.mailboxes.map(link => link.mailboxId),
  });

  return NextResponse.json({ ok: result.failed === 0, ...result });
}
