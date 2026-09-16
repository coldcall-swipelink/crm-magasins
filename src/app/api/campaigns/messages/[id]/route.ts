// src/app/api/campaigns/messages/[id]/route.ts
//
//   GET /api/campaigns/messages/<id>
//
// Un email tel qu'il est parti : son contenu exact, avec les variables déjà
// remplacées. C'est l'archive de l'envoi, pas le modèle de l'étape — modifier
// une étape aujourd'hui ne réécrit pas ce qui a été envoyé hier.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const message = await prisma.campaignMessage.findUnique({
    where: { id: params.id },
    include: {
      campaign: { select: { id: true, name: true } },
      lead: { select: { id: true, email: true, firstName: true, lastName: true, company: true } },
      mailbox: { select: { email: true } },
      step: { select: { position: true } },
    },
  });
  if (!message) return NextResponse.json({ error: 'Email introuvable' }, { status: 404 });

  // Les réponses du lead rattachées à CE message, pour lire l'échange dans
  // l'ordre plutôt que de deviner.
  const replies = await prisma.campaignReply.findMany({
    where: { leadId: message.leadId, receivedAt: { gte: message.sentAt } },
    orderBy: { receivedAt: 'asc' },
    take: 5,
    select: { id: true, subject: true, snippet: true, receivedAt: true, fromAddress: true },
  });

  return NextResponse.json({ message, replies });
}
