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
 * Renseigne la date de closing sur le premier abonnement QUI N'EN A PAS ENCORE,
 * et crée un abonnement si l'affaire n'en a aucun.
 *
 * Le point important est ce que cette fonction NE fait PAS : elle ne touche
 * jamais à un abonnement déjà daté. Une affaire qui décroche un second contrat
 * repasse par « SMARTLINKÉ » ; viser l'abonnement principal, comme on le faisait
 * avant, revenait à écraser la date du contrat en cours par celle du nouveau.
 *
 * Renvoie ce qui a été fait, pour que l'appelant puisse le dire à l'utilisateur.
 */
export async function setPendingClosingDate(
  dealId: string,
  closingDate: Date | null,
): Promise<'created' | 'updated' | 'skipped'> {
  const subs = await prisma.subscription.findMany({
    where: { dealId },
    orderBy: { position: 'asc' },
  });

  if (subs.length === 0) {
    await prisma.subscription.create({
      data: { dealId, position: 0, closingDate, subscriptionEndDate: computeSubscriptionEnd(closingDate, 12) },
    });
    await recomputeDealFromSubscriptions(dealId);
    return 'created';
  }

  const pending = subs.find(sub => !sub.closingDate);
  // Tous les abonnements sont déjà datés : il n'y a rien à renseigner, et
  // surtout rien à écraser.
  if (!pending) return 'skipped';

  await prisma.subscription.update({
    where: { id: pending.id },
    data: { closingDate, subscriptionEndDate: computeSubscriptionEnd(closingDate, pending.subscriptionMonths) },
  });
  await recomputeDealFromSubscriptions(dealId);
  return 'updated';
}

/**
 * Renseigne la date de closing d'abonnements désignés nommément (cas où la
 * pop-up en propose plusieurs, l'affaire ayant plusieurs contrats en attente).
 *
 * Deux garde-fous, appliqués côté serveur pour qu'ils tiennent quoi qu'envoie le
 * navigateur : on n'écrit que sur des abonnements DE CETTE AFFAIRE, et jamais
 * sur un abonnement dont la date de closing est déjà renseignée.
 *
 * Renvoie le nombre d'abonnements effectivement mis à jour.
 */
export async function setSubscriptionClosingDates(
  dealId: string,
  entries: { subscriptionId: string; closingDate: Date }[],
): Promise<number> {
  if (entries.length === 0) return 0;

  const subs = await prisma.subscription.findMany({ where: { dealId } });
  const byId = new Map(subs.map(sub => [sub.id, sub]));

  let updated = 0;
  for (const entry of entries) {
    const sub = byId.get(entry.subscriptionId);
    if (!sub || sub.closingDate) continue;
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        closingDate: entry.closingDate,
        subscriptionEndDate: computeSubscriptionEnd(entry.closingDate, sub.subscriptionMonths),
      },
    });
    updated++;
  }

  if (updated > 0) await recomputeDealFromSubscriptions(dealId);
  return updated;
}
