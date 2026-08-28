// src/lib/closingEvents.ts
// Historique des closings (table ClosingEvent). Quand un abonnement est validé
// avec une date de closing, on enregistre l'évènement : l'affaire, l'abonnement,
// le closeur et la date de closing — exactement comme CallLog enregistre un
// appel et DemoBooking une démo bookée.
//
// Contrairement à ces deux-là, il y a au plus UNE ligne par abonnement : un
// closing n'est pas un geste répétable. Un second contrat sur la même affaire
// est un second abonnement, donc une seconde ligne ; corriger la date ou le
// closeur d'un contrat déjà closé met la ligne existante à jour au lieu d'en
// ajouter une, sinon le même contrat compterait deux fois dans les statistiques.
//
// Best-effort, comme la journalisation des déplacements et des démos : une
// erreur d'écriture ici ne doit jamais faire échouer le closing lui-même.
import { prisma } from '@/lib/prisma';

/** D'où vient l'enregistrement, pour distinguer les chemins dans l'historique. */
export type ClosingSource = 'pipeline' | 'fiche' | 'backfill';

/** L'abonnement closé, tel qu'il vient d'être écrit en base. */
interface ClosedSubscription {
  id: string;
  dealId: string;
  closingDate: Date | null;
  value?: number | null;
  subscriptionType?: string | null;
  closedByUserId?: string | null;
  closedByName?: string | null;
}

/**
 * Aligne la trace de closing sur l'état de l'abonnement :
 *   - date de closing renseignée → la ligne est créée, ou mise à jour si elle
 *     existe déjà (correction de date, de closeur, de montant) ;
 *   - date de closing effacée → la ligne est supprimée, le closing n'a pas eu
 *     lieu.
 *
 * `recordedAt` n'est posé qu'à la création : c'est l'horodatage de l'évènement,
 * une correction ultérieure ne doit pas le décaler dans le fil d'activité.
 *
 * Renvoie 'created' | 'updated' | 'deleted' | 'noop' (aussi en cas d'erreur,
 * l'appelant n'ayant rien à rattraper).
 */
export async function syncClosingEvent(
  sub: ClosedSubscription,
  source: ClosingSource = 'pipeline',
): Promise<'created' | 'updated' | 'deleted' | 'noop'> {
  try {
    const existing = await prisma.closingEvent.findUnique({
      where: { subscriptionId: sub.id },
      select: { id: true },
    });

    if (!sub.closingDate) {
      if (!existing) return 'noop';
      await prisma.closingEvent.delete({ where: { subscriptionId: sub.id } });
      return 'deleted';
    }

    // Le closeur vient d'une identité choisie dans le navigateur : le compte
    // peut avoir été supprimé depuis. On garde alors le nom figé, sans le lien,
    // plutôt que d'échouer sur la clé étrangère.
    let userId: string | null = null;
    if (sub.closedByUserId) {
      const user = await prisma.user.findUnique({
        where: { id: sub.closedByUserId },
        select: { id: true },
      });
      userId = user?.id ?? null;
    }

    const data = {
      dealId: sub.dealId,
      userId,
      userName: sub.closedByName || '',
      closingDate: sub.closingDate,
      value: sub.value ?? null,
      subscriptionType: sub.subscriptionType || '',
    };

    if (existing) {
      // `source` n'est pas repris : il décrit par quel chemin le closing a été
      // enregistré, pas par lequel on l'a corrigé ensuite.
      await prisma.closingEvent.update({ where: { subscriptionId: sub.id }, data });
      return 'updated';
    }
    await prisma.closingEvent.create({ data: { ...data, subscriptionId: sub.id, source } });
    return 'created';
  } catch (err) {
    console.error('[syncClosingEvent]', err);
    return 'noop';
  }
}
