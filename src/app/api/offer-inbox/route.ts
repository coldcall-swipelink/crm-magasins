// src/app/api/offer-inbox/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readInboxContact } from '@/lib/import/offerInbox';

/**
 * Boîte de réception des offres poussées par l'automatisation (cf.
 * /api/webhooks/job-offers). Alimente la popup de tri et la page
 * « Offres reçues ».
 *
 *   GET /api/offer-inbox              → lots en attente + leurs offres
 *   GET /api/offer-inbox?history=1    → + les 20 derniers lots déjà tranchés
 *   GET /api/offer-inbox?countOnly=1  → juste le nombre d'offres en attente
 *                                       (badge de la barre latérale)
 */
export const dynamic = 'force-dynamic';

const offerSelect = {
  id: true, brand: true, storeName: true, city: true, postalCode: true, department: true,
  address: true, jobTitle: true, offerTitle: true, contractType: true, salary: true,
  source: true, url: true, publishedAt: true, knownStore: true, knownOffer: true,
  existingDealId: true, status: true, createdAt: true,
  // storeKey regroupe les offres d'un même magasin (une correction d'enseigne
  // s'applique à tout le groupe) ; rawData porte les contacts, relus ci-dessous.
  storeKey: true, rawData: true,
} as const;

export async function GET(req: NextRequest) {
  const countOnly = req.nextUrl.searchParams.get('countOnly') === '1';
  const withHistory = req.nextUrl.searchParams.get('history') === '1';

  try {
    const pendingCount = await prisma.inboxOffer.count({ where: { status: 'pending' } });
    if (countOnly) return NextResponse.json({ pendingCount });

    const pending = await prisma.offerInbox.findMany({
      where: { status: 'pending' },
      orderBy: { receivedAt: 'desc' },
      take: 20,
      include: {
        offers: {
          where: { status: 'pending' },
          orderBy: [{ brand: 'asc' }, { storeName: 'asc' }],
          select: offerSelect,
        },
      },
    });

    const history = withHistory
      ? await prisma.offerInbox.findMany({
          where: { status: 'processed' },
          orderBy: { receivedAt: 'desc' },
          take: 20,
          select: {
            id: true, label: true, source: true, receivedAt: true, totalRows: true,
            newRows: true, duplicateRows: true, processedAt: true, processedBy: true,
            importBatchId: true,
            _count: { select: { offers: true } },
          },
        })
      : [];

    // Où en est l'affaire d'un magasin déjà suivi ? Un magasin en « DEMO PREVUE »
    // ne se traite pas comme un « À appeler ». L'étape est relue MAINTENANT et
    // non figée à la réception : l'affaire a pu bouger entre-temps.
    const dealIds = Array.from(new Set(
      pending.flatMap(i => i.offers.map(o => o.existingDealId).filter((x): x is string => !!x)),
    ));
    const deals = dealIds.length
      ? await prisma.deal.findMany({
          where: { id: { in: dealIds } },
          select: { id: true, column: { select: { title: true } }, pipeline: { select: { name: true } } },
        })
      : [];
    const etape = new Map(deals.map(d => [d.id, { stage: d.column?.title || '', pipeline: d.pipeline?.name || '' }]));

    // L'email du contact aide à trancher dans l'écran de tri (une adresse
    // « hyperu.… » ou « uexpress.… » dit l'enseigne réelle du magasin). Il vit
    // dans la charge utile d'origine, pas en colonne : on le relit ici.
    const inboxes = pending
      .filter(i => i.offers.length > 0)
      .map(inbox => ({
        ...inbox,
        offers: inbox.offers.map(({ rawData, ...offer }) => ({
          ...offer,
          ...readInboxContact(rawData),
          dealStage: (offer.existingDealId && etape.get(offer.existingDealId)?.stage) || '',
          dealPipeline: (offer.existingDealId && etape.get(offer.existingDealId)?.pipeline) || '',
        })),
      }));

    // Un lot dont toutes les offres ont été tranchées ailleurs (autre onglet)
    // n'a plus rien à afficher : on ne le renvoie pas.
    return NextResponse.json({ pendingCount, inboxes, history });
  } catch (err) {
    // Tables absentes (base pas encore synchronisée) : état vide exploitable,
    // la popup reste simplement silencieuse.
    console.error('[GET /api/offer-inbox]', err);
    return NextResponse.json({ pendingCount: 0, inboxes: [], history: [] });
  }
}
