// src/app/api/campaigns/[id]/route.ts
//
//   GET    /api/campaigns/<id>  → la campagne, ses étapes, ses boîtes, ses stats
//   PATCH  /api/campaigns/<id>  → réglages, boîtes affectées, lancement/pause
//   DELETE /api/campaigns/<id>  → suppression (inscriptions et messages compris)

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { campaignStats } from '@/lib/campaigns/stats';

export const dynamic = 'force-dynamic';

const VALID_STATUS = ['draft', 'running', 'paused', 'finished', 'archived'];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: params.id },
    include: {
      steps: { orderBy: { position: 'asc' } },
      mailboxes: { include: { mailbox: { select: { id: true, email: true, displayName: true, active: true } } } },
    },
  });
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  return NextResponse.json({ campaign, stats: await campaignStats(params.id) });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const existing = await prisma.campaign.findUnique({
    where: { id: params.id },
    include: { steps: true, mailboxes: true },
  });
  if (!existing) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.description !== undefined) data.description = String(body.description);
  if (body.stopOnReply !== undefined) data.stopOnReply = Boolean(body.stopOnReply);
  if (body.trackOpens !== undefined) data.trackOpens = Boolean(body.trackOpens);
  if (body.addUnsubscribe !== undefined) data.addUnsubscribe = Boolean(body.addUnsubscribe);

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!VALID_STATUS.includes(status)) {
      return NextResponse.json({ error: 'Statut inconnu' }, { status: 400 });
    }
    // Lancer une campagne suppose qu'elle puisse envoyer : au moins une étape
    // rédigée et une boîte active. Mieux vaut le refuser ici que laisser le
    // moteur tourner à vide.
    if (status === 'running') {
      const usable = existing.steps.some(step => step.subject.trim() && (step.bodyText.trim() || step.bodyHtml.trim()));
      if (!usable) {
        return NextResponse.json({ error: 'Rédigez au moins une étape (sujet et corps) avant de lancer.' }, { status: 422 });
      }
      const boxes = await prisma.mailbox.count({
        where: { active: true, campaigns: { some: { campaignId: params.id } } },
      });
      if (boxes === 0) {
        return NextResponse.json({ error: "Affectez au moins une boîte d'envoi active à cette campagne." }, { status: 422 });
      }
      if (!existing.startedAt) data.startedAt = new Date();
    }
    if (status === 'finished') data.finishedAt = new Date();
    data.status = status;
  }

  // Boîtes affectées : on remplace l'ensemble, c'est ce que l'écran manipule.
  if (Array.isArray(body.mailboxIds)) {
    const wanted = new Set<string>(body.mailboxIds.map((id: unknown) => String(id)));
    const current = new Set(existing.mailboxes.map(link => link.mailboxId));
    const toAdd = Array.from(wanted).filter(id => !current.has(id));
    const toRemove = Array.from(current).filter(id => !wanted.has(id));

    if (toRemove.length) {
      await prisma.campaignMailbox.deleteMany({
        where: { campaignId: params.id, mailboxId: { in: toRemove } },
      });
    }
    if (toAdd.length) {
      await prisma.campaignMailbox.createMany({
        data: toAdd.map(mailboxId => ({ campaignId: params.id, mailboxId })),
        skipDuplicates: true,
      });
    }
  }

  const campaign = await prisma.campaign.update({
    where: { id: params.id },
    data,
    include: {
      steps: { orderBy: { position: 'asc' } },
      mailboxes: { include: { mailbox: { select: { id: true, email: true, displayName: true, active: true } } } },
    },
  });

  return NextResponse.json({ campaign });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const existing = await prisma.campaign.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  // Étapes, inscriptions et messages partent avec (onDelete: Cascade).
  await prisma.campaign.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
