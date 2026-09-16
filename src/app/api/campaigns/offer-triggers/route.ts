// src/app/api/campaigns/offer-triggers/route.ts
//
//   GET  /api/campaigns/offer-triggers  → règles + de quoi remplir l'écran
//        (campagnes, pipelines, enseignes, intitulés les plus fréquents)
//   POST /api/campaigns/offer-triggers  → création d'une règle
//
// Une règle relie un intitulé d'offre à une campagne : « quand une offre de
// boucher sort, inscris le contact de l'affaire dans la campagne bouchers ».

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseKeywords } from '@/lib/campaigns/offerMatch';
import { commonJobTitles } from '@/lib/campaigns/offerTriggers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [triggers, campaigns, pipelines, brands, titles] = await Promise.all([
      prisma.offerTrigger.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          campaign: { select: { id: true, name: true, status: true } },
          _count: { select: { hits: true } },
        },
      }),
      prisma.campaign.findMany({
        where: { status: { not: 'archived' } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, status: true },
      }),
      prisma.pipeline.findMany({ orderBy: { position: 'asc' }, select: { id: true, name: true } }),
      prisma.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      commonJobTitles(),
    ]);

    return NextResponse.json({ triggers, campaigns, pipelines, brands, titles });
  } catch (err) {
    // Comme pour la liste des leads : une lecture qui échoue ne doit pas
    // ressembler à « aucune règle ».
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/campaigns/offer-triggers]', err);
    const missing = /does not exist|P2021|P2022/i.test(message);
    return NextResponse.json({
      error: missing
        ? "La base est en retard sur l'application : les tables des déclencheurs "
          + "n'existent pas encore. Ouvrez /api/admin/db-sync?token=sync-crm-2026 "
          + 'puis rechargez cette page.'
        : `Lecture des déclencheurs impossible : ${message}`,
      detail: message,
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });

  const name = String(body.name || '').trim();
  const keywords = String(body.keywords || '').trim();
  const campaignId = String(body.campaignId || '').trim();

  if (!name) return NextResponse.json({ error: 'Donnez un nom à la règle' }, { status: 400 });
  if (parseKeywords(keywords).length === 0) {
    return NextResponse.json({ error: 'Indiquez au moins un terme à rechercher' }, { status: 400 });
  }
  if (!campaignId) return NextResponse.json({ error: 'Choisissez la campagne de destination' }, { status: 400 });

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } });
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 400 });

  const trigger = await prisma.offerTrigger.create({
    data: {
      name,
      keywords,
      exclude: String(body.exclude || '').trim(),
      campaignId,
      active: body.active !== false,
      pipelineId: body.pipelineId ? String(body.pipelineId) : null,
      brandId: body.brandId ? String(body.brandId) : null,
      userName: body.userName ? String(body.userName).trim() : null,
      // `since` reste à sa valeur par défaut (maintenant) : une règle nouvelle
      // ne regarde que ce qui sortira désormais. Reprendre l'historique est
      // une action séparée, chiffrée avant d'être lancée.
    },
    include: { campaign: { select: { id: true, name: true, status: true } } },
  });

  return NextResponse.json({ trigger }, { status: 201 });
}
