import { prisma } from '@/lib/prisma';
import { addMonths } from '@/lib/utils';
import { syncClosingEvent } from '@/lib/closingEvents';

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

/** Closeur choisi dans la pop-up : compte CRM et nom figé. */
export interface Closer {
  userId?: string | null;
  userName?: string | null;
}

/**
 * Prépare les colonnes closedBy* à écrire. Le compte est vérifié : l'identité
 * vient du navigateur et peut désigner un utilisateur supprimé depuis — on
 * garde alors le nom, sans le lien, plutôt que d'échouer sur la clé étrangère.
 * Renvoie un objet vide si aucun closeur n'a été choisi : on n'écrase pas une
 * attribution existante avec du vide.
 */
async function closerData(closer?: Closer) {
  if (!closer || (!closer.userId && !closer.userName)) return {};
  let closedByUserId: string | null = null;
  if (closer.userId) {
    const user = await prisma.user.findUnique({ where: { id: closer.userId }, select: { id: true } });
    closedByUserId = user?.id ?? null;
  }
  return { closedByUserId, closedByName: closer.userName || '' };
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
  closer?: Closer,
): Promise<'created' | 'updated' | 'skipped'> {
  const closedBy = await closerData(closer);
  const subs = await prisma.subscription.findMany({
    where: { dealId },
    orderBy: { position: 'asc' },
  });

  if (subs.length === 0) {
    const created = await prisma.subscription.create({
      data: { dealId, position: 0, closingDate, subscriptionEndDate: computeSubscriptionEnd(closingDate, 12), ...closedBy },
    });
    // Trace du closing (affaire, abonnement, closeur, date) : une ligne de plus
    // dans l'historique, au même titre qu'un appel ou une démo bookée.
    await syncClosingEvent(created, 'pipeline');
    await recomputeDealFromSubscriptions(dealId);
    return 'created';
  }

  const pending = subs.find(sub => !sub.closingDate);
  // Tous les abonnements sont déjà datés : il n'y a rien à renseigner, et
  // surtout rien à écraser.
  if (!pending) return 'skipped';

  const updated = await prisma.subscription.update({
    where: { id: pending.id },
    data: { closingDate, subscriptionEndDate: computeSubscriptionEnd(closingDate, pending.subscriptionMonths), ...closedBy },
  });
  await syncClosingEvent(updated, 'pipeline');
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
  closer?: Closer,
): Promise<number> {
  if (entries.length === 0) return 0;
  const closedBy = await closerData(closer);

  const subs = await prisma.subscription.findMany({ where: { dealId } });
  const byId = new Map(subs.map(sub => [sub.id, sub]));

  let updated = 0;
  for (const entry of entries) {
    const sub = byId.get(entry.subscriptionId);
    if (!sub || sub.closingDate) continue;
    const row = await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        closingDate: entry.closingDate,
        subscriptionEndDate: computeSubscriptionEnd(entry.closingDate, sub.subscriptionMonths),
        ...closedBy,
      },
    });
    // Un abonnement daté = un closing : une ligne ClosingEvent par abonnement.
    await syncClosingEvent(row, 'pipeline');
    updated++;
  }

  if (updated > 0) await recomputeDealFromSubscriptions(dealId);
  return updated;
}
