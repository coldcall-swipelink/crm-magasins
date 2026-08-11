// src/app/api/dashboard/closing/route.ts
// Données d'analyse du closing : UNE ligne par abonnement closé (date de closing
// renseignée). Chaque abonnement porte sa propre date de closing et sa valeur,
// si bien que le 2e abonnement d'un client existant est compté à sa propre date.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Live : jamais pré-généré au build (pas d'accès DB à la compilation).
export const dynamic = 'force-dynamic';

export async function GET() {
  const [subs, brands, demoDeals, churnedSubs] = await Promise.all([
    prisma.subscription.findMany({
      // On exclut les abonnements résiliés (churn) : leur valeur ne doit plus
      // compter dans le MRR ni dans aucune autre donnée du Dashboard.
      where: { closingDate: { not: null }, churned: false },
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
    // Deals ayant une date de démo (repère « arrivé dans DEMO PREVUE ») :
    // dénominateur du taux de closing. Un deal = une date de démo.
    prisma.deal.findMany({
      where: { demoDate: { not: null } },
      select: {
        id: true,
        demoDate: true,
        store: { select: { brand: { select: { id: true } } } },
      },
    }),
    // Abonnements résiliés (churn) ayant une date de closing : servent UNIQUEMENT
    // au calcul du « taux de churn » du dashboard (clients perdus / clients
    // totaux sur la période). Leur valeur reste exclue du MRR et du reste.
    prisma.subscription.findMany({
      where: { churned: true },
      select: {
        closingDate: true,
        churnedAt: true,
        deal: { select: { id: true, store: { select: { brand: { select: { id: true } } } } } },
      },
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
    // Une ligne par deal ayant une date de démo (dénominateur du taux de closing).
    demos: demoDeals.map(d => ({
      dealId: d.id,
      demoDate: d.demoDate!.toISOString(),
      brandId: d.store?.brand?.id ?? null,
    })),
    // Une ligne par abonnement résilié (churn), pour le taux de churn. Le client
    // perdu est rattaché à la période via sa date de résiliation (churnedAt) ;
    // repli sur la date de closing pour d'éventuelles lignes résiliées avant
    // l'ajout de la date de churn. Les lignes sans aucune date sont ignorées.
    churned: churnedSubs
      .map(s => ({
        dealId: s.deal?.id ?? '',
        churnDate: (s.churnedAt ?? s.closingDate)?.toISOString() ?? null,
        closingDate: s.closingDate?.toISOString() ?? null,
        brandId: s.deal?.store?.brand?.id ?? null,
      }))
      .filter(c => c.churnDate),
    brands,
    generatedAt: new Date().toISOString(),
  });
}
