// src/app/api/payments/route.ts
// Échéancier des prochains paiements : projette, pour chaque abonnement closé
// (date de closing + valeur renseignées), toutes les échéances de la date de
// closing jusqu'à un horizon fixe (5 ans), selon le type d'abonnement et la
// cadence de paiement. Renvoie une ligne par échéance, triées par date.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { addMonths } from '@/lib/utils';
import { generatePaymentSchedule } from '@/lib/payments';
import { USE_MOCK_DATA, mockSubscriptions, mockDeals, mockBrands } from '@/lib/mockData';

// Live : jamais pré-généré au build (pas d'accès DB à la compilation).
export const dynamic = 'force-dynamic';

// Horizon de projection (mois). Fixe, indépendant de la durée d'abonnement.
const HORIZON_MONTHS = 60; // 5 ans

export async function GET() {
  // Preview (mock) : pas de base de données. On projette l'échéancier à partir
  // des abonnements fictifs (cf. src/lib/mockData.ts).
  if (USE_MOCK_DATA) {
    const horizonEnd = addMonths(new Date(), HORIZON_MONTHS);
    const payments = mockSubscriptions.flatMap(s => {
      const deal = mockDeals.find(d => d.id === s.dealId);
      const schedule = generatePaymentSchedule(
        { closingDate: s.closingDate, subscriptionType: s.subscriptionType, paymentTiming: s.paymentTiming, value: s.value },
        horizonEnd,
      );
      return schedule.map(occ => ({
        id: `${s.id}-${occ.index}`,
        subscriptionId: s.id,
        dealId: s.dealId,
        index: occ.index,
        date: occ.date.toISOString(),
        amount: occ.amount,
        type: s.subscriptionType || '',
        paymentTiming: s.paymentTiming === 'mensuel' ? 'mensuel' : 'comptant',
        paymentMode: s.paymentMode === 'virement' ? 'virement' : 'stripe',
        storeName: deal?.store?.name ?? '',
        city: deal?.store?.city ?? '',
        brandId: deal?.store?.brand?.id ?? null,
        brandName: deal?.store?.brand?.name ?? 'Sans enseigne',
        brandColor: deal?.store?.brand?.color ?? '#94a3b8',
      }));
    });
    payments.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return NextResponse.json({
      payments,
      horizonMonths: HORIZON_MONTHS,
      brands: mockBrands.map(b => ({ id: b.id, name: b.name, color: b.color })),
      generatedAt: new Date().toISOString(),
    });
  }

  const [subs, brands] = await Promise.all([
    prisma.subscription.findMany({
      where: { closingDate: { not: null }, value: { not: null } },
      select: {
        id: true,
        value: true,
        subscriptionType: true,
        paymentTiming: true,
        paymentMode: true,
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
    }),
    prisma.brand.findMany({
      select: { id: true, name: true, color: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const horizonEnd = addMonths(new Date(), HORIZON_MONTHS);

  const payments = subs.flatMap(s => {
    const schedule = generatePaymentSchedule(
      {
        closingDate: s.closingDate,
        subscriptionType: s.subscriptionType,
        paymentTiming: s.paymentTiming,
        value: s.value,
      },
      horizonEnd,
    );
    return schedule.map(occ => ({
      id: `${s.id}-${occ.index}`,
      subscriptionId: s.id,
      dealId: s.deal?.id ?? '',
      index: occ.index,
      date: occ.date.toISOString(),
      amount: occ.amount,
      type: s.subscriptionType || '',
      paymentTiming: s.paymentTiming === 'mensuel' ? 'mensuel' : 'comptant',
      paymentMode: s.paymentMode === 'virement' ? 'virement' : 'stripe',
      storeName: s.deal?.store?.name ?? '',
      city: s.deal?.store?.city ?? '',
      brandId: s.deal?.store?.brand?.id ?? null,
      brandName: s.deal?.store?.brand?.name ?? 'Sans enseigne',
      brandColor: s.deal?.store?.brand?.color ?? '#94a3b8',
    }));
  });

  payments.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return NextResponse.json({
    payments,
    horizonMonths: HORIZON_MONTHS,
    brands,
    generatedAt: new Date().toISOString(),
  });
}
