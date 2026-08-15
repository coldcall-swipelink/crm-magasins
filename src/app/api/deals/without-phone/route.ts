// src/app/api/deals/without-phone/route.ts
// Affaires dont le numéro de contact est vide — c'est-à-dire celles qu'on ne
// peut pas appeler. La recherche automatique (cf. /api/phone-lookup) en résout
// la majeure partie ; ce qui reste se saisit à la main depuis les Paramètres.
//
//   GET  → { items, total } : les affaires sans numéro, filtrables par enseigne,
//          magasin, ville ou code postal, paginées (limit / offset).
//   POST → { dealId, phone } : enregistre le numéro sur l'affaire, et sur le
//          magasin s'il n'en a pas encore — mêmes règles que la file de
//          vérification, un numéro déjà présent n'est jamais écrasé.
import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { normalizePhone } from '@/lib/phone/normalize';
import { USE_MOCK_DATA } from '@/lib/mockData';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest) {
  if (USE_MOCK_DATA) return NextResponse.json({ items: [], total: 0 });
  try {
    const q = (req.nextUrl.searchParams.get('q') || '').trim();
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(Number(req.nextUrl.searchParams.get('offset')) || 0, 0);

    const where: Prisma.DealWhereInput = {
      contactPhone: '',
      ...(q
        ? {
            store: {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { city: { contains: q, mode: 'insensitive' } },
                { postalCode: { startsWith: q } },
                { brand: { name: { contains: q, mode: 'insensitive' } } },
              ],
            },
          }
        : {}),
    };

    const [deals, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        select: {
          id: true,
          storeId: true,
          column: { select: { title: true } },
          store: {
            select: {
              name: true, city: true, postalCode: true, address: true, phone: true,
              brand: { select: { name: true } },
            },
          },
        },
        // Regroupe les magasins d'une même enseigne : on cherche plus vite
        // plusieurs numéros à la suite quand les fiches se ressemblent.
        orderBy: [{ store: { name: 'asc' } }],
        skip: offset,
        take: limit,
      }),
      prisma.deal.count({ where }),
    ]);

    const items = deals.map(d => ({
      dealId: d.id,
      storeId: d.storeId,
      label: [d.store.brand?.name, d.store.name, d.store.city].filter(Boolean).join(' — '),
      address: [d.store.address, d.store.postalCode, d.store.city].filter(Boolean).join(' '),
      // Numéro connu du magasin mais absent de l'affaire (numéro trouvé après
      // la création de l'affaire, ou effacé depuis) : proposé en un clic.
      storePhone: d.store.phone || '',
      columnTitle: d.column?.title || '',
    }));

    return NextResponse.json({ items, total });
  } catch (err) {
    console.error('[GET /api/deals/without-phone]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (USE_MOCK_DATA) {
    return NextResponse.json({ error: 'Indisponible en mode démonstration' }, { status: 400 });
  }
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const dealId = typeof body.dealId === 'string' ? body.dealId : '';
    if (!dealId) return NextResponse.json({ error: 'dealId manquant' }, { status: 400 });

    const normalized = normalizePhone(typeof body.phone === 'string' ? body.phone : '');
    if (!normalized) {
      return NextResponse.json({ error: 'Numéro invalide' }, { status: 400 });
    }

    const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true, storeId: true } });
    if (!deal) return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });

    await prisma.deal.update({
      where: { id: deal.id },
      data: { contactPhone: normalized.display },
    });
    // Le magasin hérite du numéro s'il n'en a pas : la recherche automatique
    // cesse alors de le traiter, et les compteurs de couverture restent justes.
    await prisma.store.updateMany({
      where: { id: deal.storeId, phone: '' },
      data: {
        phone: normalized.display,
        phoneSource: 'manuel',
        phoneLookupStatus: 'trouve',
        phoneLookupAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, dealId: deal.id, phone: normalized.display });
  } catch (err) {
    console.error('[POST /api/deals/without-phone]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
