// src/app/api/campaigns/route.ts
//
//   GET  /api/campaigns  → la liste, avec les chiffres de chaque campagne
//                          (inscrits, progression, ouverture, réponse)
//   POST /api/campaigns  → crée une campagne (brouillon, avec une étape vide)
//
// Une campagne naît toujours en brouillon : elle n'envoie rien tant qu'elle
// n'a pas été lancée explicitement.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { campaignRowStats } from '@/lib/campaigns/stats';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Les mêmes lignes que le tableau de la vue d'ensemble : une campagne
  // affiche les mêmes chiffres partout, et les actives passent en tête.
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, status: true, createdAt: true, _count: { select: { steps: true } } },
  });
  return NextResponse.json({ campaigns: await campaignRowStats(campaigns) });
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
