// src/app/api/campaigns/[id]/steps/route.ts
//
//   POST /api/campaigns/<id>/steps  → ajoute une étape à la fin de la séquence
//
// Le délai par défaut (3 jours) est celui d'une relance raisonnable ; il se
// règle étape par étape ensuite.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: params.id },
    include: { steps: { orderBy: { position: 'desc' }, take: 1 } },
  });
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const position = (campaign.steps[0]?.position ?? 0) + 1;

  const step = await prisma.campaignStep.create({
    data: {
      campaignId: params.id,
      position,
      delayHours: Number.isFinite(Number(body?.delayHours)) ? Math.max(0, Math.round(Number(body.delayHours))) : 72,
      subject: String(body?.subject || ''),
      bodyText: String(body?.bodyText || ''),
      // Une relance reprend le fil du premier email par défaut : c'est ce qui
      // la fait lire comme une relance et non comme un deuxième démarchage.
      replyToThread: body?.replyToThread === undefined ? position > 1 : Boolean(body.replyToThread),
    },
  });

  return NextResponse.json({ step }, { status: 201 });
}
