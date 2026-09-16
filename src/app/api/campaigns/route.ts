// src/app/api/campaigns/route.ts
//
//   GET  /api/campaigns  → la liste, avec le compte des inscriptions et des
//                          envois (de quoi afficher la carte d'une campagne)
//   POST /api/campaigns  → crée une campagne (brouillon, avec une étape vide)
//
// Une campagne naît toujours en brouillon : elle n'envoie rien tant qu'elle
// n'a pas été lancée explicitement.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { enrollments: true, steps: true } },
      mailboxes: { include: { mailbox: { select: { id: true, email: true, active: true } } } },
    },
  });

  // Compteurs d'envoi par campagne, en deux agrégats plutôt qu'en N requêtes.
  const [sent, replies] = await Promise.all([
    prisma.campaignMessage.groupBy({
      by: ['campaignId'], where: { status: 'sent' }, _count: { _all: true },
    }),
    prisma.campaignMessage.groupBy({
      by: ['campaignId'], where: { repliedAt: { not: null } }, _count: { _all: true },
    }),
  ]);
  const sentBy = Object.fromEntries(sent.map(row => [row.campaignId, row._count._all]));
  const replyBy = Object.fromEntries(replies.map(row => [row.campaignId, row._count._all]));

  return NextResponse.json({
    campaigns: campaigns.map(campaign => ({
      ...campaign,
      sentCount: sentBy[campaign.id] || 0,
      replyCount: replyBy[campaign.id] || 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const name = String(body?.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Nom requis' }, { status: 400 });

  const requested: string[] = Array.isArray(body?.mailboxIds)
    ? body.mailboxIds.map((id: unknown) => String(id)) : [];

  // Une boîte inconnue ferait échouer la création sur une contrainte de clé
  // étrangère, avec une erreur 500 illisible. On vérifie d'abord.
  const mailboxIds = requested.length
    ? (await prisma.mailbox.findMany({
        where: { id: { in: requested } }, select: { id: true },
      })).map(mailbox => mailbox.id)
    : [];
  if (requested.length !== mailboxIds.length) {
    return NextResponse.json({ error: "Boîte d'envoi introuvable" }, { status: 400 });
  }

  const campaign = await prisma.campaign.create({
    data: {
      name,
      description: String(body?.description || '').trim(),
      userName: body?.userName ? String(body.userName).trim() : null,
      mailboxes: { create: mailboxIds.map(mailboxId => ({ mailboxId })) },
      // Une campagne sans étape ne sert à rien : on en pose une, vide, prête
      // à être rédigée. Délai 0 : le premier email part dès l'inscription.
      steps: { create: [{ position: 1, delayHours: 0, subject: '', bodyText: '' }] },
    },
    include: { steps: true, mailboxes: true },
  });

  return NextResponse.json({ campaign }, { status: 201 });
}
