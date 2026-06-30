// src/app/api/dashboard/closing/route.ts
// Données d'analyse du closing : UNE ligne par abonnement closé (date de closing
// renseignée). Chaque abonnement porte sa propre date de closing et sa valeur,
// si bien que le 2e abonnement d'un client existant est compté à sa propre date.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Live : jamais pré-généré au build (pas d'accès DB à la compilation).
export const dynamic = 'force-dynamic';

export async function GET() {
  const [subs, brands] = await Promise.all([
    prisma.subscription.findMany({
      where: { closingDate: { not: null } },
      select: {
        id: true,
        value: true,
        subscriptionType: true,
        paymentMode: true,
        subscriptionMonths: true,
        closingDate: true,
        deal: {
          select: {
            id: true,
            store: {
              select: {
                name: true,
                city: true,
                brand: { select: { id: true, name: true, color: true } },
              },
            },
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
    closings: subs.map(s => ({
      id: s.id,
      dealId: s.deal?.id ?? '',
      value: s.value ?? 0,
      months: s.subscriptionMonths ?? 12,
      type: s.subscriptionType || '',
      paymentMode: s.paymentMode === 'virement' ? 'virement' : 'stripe',
      closingDate: s.closingDate!.toISOString(),
      storeName: s.deal?.store?.name ?? '',
      city: s.deal?.store?.city ?? '',
      brandId: s.deal?.store?.brand?.id ?? null,
      brandName: s.deal?.store?.brand?.name ?? 'Sans enseigne',
      brandColor: s.deal?.store?.brand?.color ?? '#94a3b8',
    })),
    brands,
    generatedAt: new Date().toISOString(),
  });
}
