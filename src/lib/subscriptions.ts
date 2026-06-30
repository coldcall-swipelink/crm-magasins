import { prisma } from '@/lib/prisma';
import { addMonths } from '@/lib/utils';

/**
 * Recalcule les champs dénormalisés du deal à partir de ses abonnements :
 *  - dealValue            = somme des valeurs des abonnements
 *  - closingDate / paymentMode / paymentTiming / subscriptionType /
 *    subscriptionMonths / subscriptionEndDate = ceux de l'abonnement principal
 *    (position 0).
 * Permet aux cartes, totaux de colonnes et au dashboard de continuer à lire ces
 * champs sur le deal sans connaître le détail des abonnements.
 */
export async function recomputeDealFromSubscriptions(dealId: string) {
  const subs = await prisma.subscription.findMany({
    where: { dealId },
    orderBy: { position: 'asc' },
  });
  const primary = subs[0];
  const total = subs.reduce((s, x) => s + (x.value ?? 0), 0);

  await prisma.deal.update({
    where: { id: dealId },
    data: {
      dealValue: subs.length ? total : null,
      closingDate: primary?.closingDate ?? null,
      paymentMode: primary?.paymentMode ?? 'stripe',
      paymentTiming: primary?.paymentTiming ?? 'comptant',
      subscriptionType: primary?.subscriptionType ?? '',
      subscriptionMonths: primary?.subscriptionMonths ?? 12,
      subscriptionEndDate: primary?.subscriptionEndDate ?? null,
    },
  });
}

/** Date de fin = closingDate + durée (mois), ou null. */
export function computeSubscriptionEnd(closingDate: Date | null, months: number): Date | null {
  return closingDate && months > 0 ? addMonths(closingDate, months) : null;
}

/**
 * Renseigne la date de closing sur l'abonnement principal d'un deal (créé s'il
 * n'en a aucun), recalcule sa date de fin, puis met à jour le deal dénormalisé.
 * Utilisé au drag & drop dans la colonne « SMARTLINKÉ ».
 */
export async function setPrimaryClosingDate(dealId: string, closingDate: Date | null) {
  const primary = await prisma.subscription.findFirst({
    where: { dealId },
    orderBy: { position: 'asc' },
  });
  if (primary) {
    await prisma.subscription.update({
      where: { id: primary.id },
      data: { closingDate, subscriptionEndDate: computeSubscriptionEnd(closingDate, primary.subscriptionMonths) },
    });
  } else {
    await prisma.subscription.create({
      data: { dealId, position: 0, closingDate, subscriptionEndDate: computeSubscriptionEnd(closingDate, 12) },
    });
  }
  await recomputeDealFromSubscriptions(dealId);
}
