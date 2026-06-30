// src/app/api/dashboard/closing/route.ts
// Données d'analyse du closing : tous les deals « closés » (date de closing
// renseignée), allégés pour le calcul côté client (MRR, nouveaux clients,
// comparaisons de périodes, répartition par enseigne et mode de paiement).
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Live : jamais pré-généré au build (pas d'accès DB à la compilation).
export const dynamic = 'force-dynamic';

export async function GET() {
  const [deals, brands] = await Promise.all([
    prisma.deal.findMany({
      where: { closingDate: { not: null } },
      select: {
        id: true,
        dealValue: true,
        closingDate: true,
        paymentMode: true,
        store: {
          select: {
            name: true,
            city: true,
            brand: { select: { id: true, name: true, color: true } },
          },
        },
      },
      orderBy: { closingDate: 'desc' },
    }),
    prisma.brand.findMany({
      select: { id: true, name: true, color: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return NextResponse.json({
    deals: deals.map(d => ({
      id: d.id,
      value: d.dealValue ?? 0,
      closingDate: d.closingDate!.toISOString(),
      paymentMode: d.paymentMode === 'virement' ? 'virement' : 'stripe',
      storeName: d.store?.name ?? '',
      city: d.store?.city ?? '',
      brandId: d.store?.brand?.id ?? null,
      brandName: d.store?.brand?.name ?? 'Sans enseigne',
      brandColor: d.store?.brand?.color ?? '#94a3b8',
    })),
    brands,
    generatedAt: new Date().toISOString(),
  });
}
