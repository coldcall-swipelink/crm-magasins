// src/app/api/offer-inbox/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

    // Un lot dont toutes les offres ont été tranchées ailleurs (autre onglet)
    // n'a plus rien à afficher : on ne le renvoie pas.
    return NextResponse.json({
      pendingCount,
      inboxes: pending.filter(i => i.offers.length > 0),
      history,
    });
  } catch (err) {
    // Tables absentes (base pas encore synchronisée) : état vide exploitable,
    // la popup reste simplement silencieuse.
    console.error('[GET /api/offer-inbox]', err);
    return NextResponse.json({ pendingCount: 0, inboxes: [], history: [] });
  }
}
