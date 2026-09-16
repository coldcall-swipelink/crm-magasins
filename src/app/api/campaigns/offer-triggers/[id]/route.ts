// src/app/api/campaigns/offer-triggers/[id]/route.ts
//
//   GET    /api/campaigns/offer-triggers/<id>  → règle + son journal
//   PATCH  /api/campaigns/offer-triggers/<id>  → modification / mise en pause
//   DELETE /api/campaigns/offer-triggers/<id>  → suppression
//
// Le journal est la partie importante : c'est lui qui explique pourquoi une
// règle a inscrit — ou n'a pas inscrit — un contact donné.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { parseKeywords } from '@/lib/campaigns/offerMatch';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const trigger = await prisma.offerTrigger.findUnique({
    where: { id: params.id },
    include: {
      campaign: { select: { id: true, name: true, status: true } },
      hits: { orderBy: { createdAt: 'desc' }, take: 200 },
    },
  });
  if (!trigger) return NextResponse.json({ error: 'Règle introuvable' }, { status: 404 });

  // Les leads cités par le journal, pour afficher un nom plutôt qu'un
  // identifiant.
  const leadIds = Array.from(new Set(trigger.hits.map(hit => hit.leadId).filter((id): id is string => !!id)));
  const leads = leadIds.length
    ? await prisma.lead.findMany({
        where: { id: { in: leadIds } },
        select: { id: true, email: true, civility: true, lastName: true, company: true },
      })
    : [];

  return NextResponse.json({ trigger, leads });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const existing = await prisma.offerTrigger.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: 'Règle introuvable' }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });

  const data: Prisma.OfferTriggerUpdateInput = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: 'Donnez un nom à la règle' }, { status: 400 });
    data.name = name;
  }
  if (body.keywords !== undefined) {
    const keywords = String(body.keywords).trim();
    if (parseKeywords(keywords).length === 0) {
      return NextResponse.json({ error: 'Indiquez au moins un terme à rechercher' }, { status: 400 });
    }
    data.keywords = keywords;
  }
  if (body.exclude !== undefined) data.exclude = String(body.exclude).trim();
  if (body.active !== undefined) data.active = body.active === true;
  if (body.pipelineId !== undefined) data.pipelineId = body.pipelineId ? String(body.pipelineId) : null;
  if (body.brandId !== undefined) data.brandId = body.brandId ? String(body.brandId) : null;

  if (body.campaignId !== undefined) {
    const campaignId = String(body.campaignId);
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } });
    if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 400 });
    data.campaign = { connect: { id: campaignId } };
  }

  // Reprise de l'historique : on recule le plancher temporel de la règle, ce
  // qui rend éligibles les offres déjà relevées. Demandé explicitement depuis
  // l'écran, après affichage du nombre de contacts concernés — jamais une
  // conséquence silencieuse d'une autre modification.
  if (body.since !== undefined) {
    const since = body.since === null ? new Date(0) : new Date(String(body.since));
    if (Number.isNaN(since.getTime())) {
      return NextResponse.json({ error: 'Date de départ invalide' }, { status: 400 });
    }
    data.since = since;
  }

  const trigger = await prisma.offerTrigger.update({
    where: { id: params.id },
    data,
    include: { campaign: { select: { id: true, name: true, status: true } } },
  });

  return NextResponse.json({ trigger });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const existing = await prisma.offerTrigger.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: 'Règle introuvable' }, { status: 404 });

  // Le journal part avec la règle (onDelete: Cascade). Les leads inscrits et
  // les emails déjà partis, eux, ne bougent pas : supprimer la règle arrête
  // les prochaines détections, ce n'est pas une annulation rétroactive.
  await prisma.offerTrigger.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
