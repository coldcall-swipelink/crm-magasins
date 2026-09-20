// src/app/api/campaigns/[id]/route.ts
//
//   GET    /api/campaigns/<id>  → la campagne, ses étapes, ses boîtes, ses stats
//   PATCH  /api/campaigns/<id>  → réglages, boîtes affectées, lancement/pause
//   DELETE /api/campaigns/<id>  → suppression (inscriptions et messages compris)

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { campaignStats } from '@/lib/campaigns/stats';
import { runDueSends } from '@/lib/campaigns/engine';
import { stepIsUsable } from '@/lib/campaigns/variants';

export const dynamic = 'force-dynamic';
// Le lancement déclenche un premier passage du moteur : il lui faut du temps.
export const maxDuration = 60;

const VALID_STATUS = ['draft', 'running', 'paused', 'finished', 'archived'];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: params.id },
      include: {
        steps: { orderBy: { position: 'asc' }, include: { variants: { orderBy: { key: 'asc' } } } },
        mailboxes: { include: { mailbox: { select: { id: true, email: true, displayName: true, active: true } } } },
      },
    });
    if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

    return NextResponse.json({ campaign, stats: await campaignStats(params.id) });
  } catch (err) {
    // Une base en retard sur le schéma (table ou colonne pas encore créée)
    // tombe ici. En JSON, avec le message de Prisma : l'écran peut l'afficher
    // et dire quoi faire, au lieu d'un 500 muet qui le laisse « charger ».
    const message = err instanceof Error ? err.message : String(err);
    console.error('[campaigns/GET]', message);
    return NextResponse.json({ error: message.split('\n').filter(Boolean).slice(-1)[0] || 'Erreur serveur' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const existing = await prisma.campaign.findUnique({
    where: { id: params.id },
    include: { steps: { include: { variants: true } }, mailboxes: true },
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
      // Une étape en test A/B compte si l'une de ses variantes est rédigée ;
      // une étape à modèle du CRM compte toujours (cf. stepIsUsable).
      const usable = existing.steps.some(stepIsUsable);
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
      steps: { orderBy: { position: 'asc' }, include: { variants: { orderBy: { key: 'asc' } } } },
      mailboxes: { include: { mailbox: { select: { id: true, email: true, displayName: true, active: true } } } },
    },
  });

  // Lancement : la première salve part immédiatement, sans attendre le cron.
  // « Lancer la campagne » doit produire un effet visible tout de suite.
  let sent = 0;
  if (data.status === 'running') {
    try {
      const result = await runDueSends({
        budgetMs: 20_000,
        mailboxIds: campaign.mailboxes.map(link => link.mailboxId),
      });
      sent = result.sent;
    } catch (err) {
      console.error('[campaigns/PATCH] première salve', err);
    }
  }

  return NextResponse.json({ campaign, sent });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const existing = await prisma.campaign.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  // Étapes, inscriptions et messages partent avec (onDelete: Cascade).
  await prisma.campaign.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
