// src/lib/campaigns/bounceCleanup.ts
//
// Effacer l'« ouverture » d'un message rejeté.
//
// Un rapport de non-remise cite l'email d'origine, pixel de suivi compris : le
// lire dans sa propre boîte déclenche le pixel et compte une ouverture pour un
// email que personne n'a reçu. Le correctif vit ici pour que le relevé IMAP
// (en direct) et le script de rattrapage (sur l'historique) appliquent
// exactement la même règle.
//
// Prudence délibérée : on n'efface QUE l'ouverture du message rejeté. Un lead
// dont l'adresse meurt à l'étape 3 a pu lire les étapes 1 et 2 — ces
// ouvertures-là sont vraies, et les effacer serait une seconde erreur. De
// même, `lastOpenedAt` est RECALCULÉ sur ce qui reste, jamais vidé
// aveuglément, et la frise ne perd que SA ligne — celle de la campagne et de
// l'étape du message rejeté, telle que le pixel l'avait écrite.

import { prisma } from '@/lib/prisma';

export type BounceCleanup = {
  /** Le message portait une ouverture, désormais effacée. */
  openCleared: boolean;
  /** Ouvertures qui restent au lead, sur d'autres messages. */
  remainingOpens: number;
  /** Lignes « Email ouvert » retirées de la frise. */
  eventsRemoved: number;
};

/**
 * Marque un message comme rejeté et retire l'ouverture qu'il n'aurait jamais
 * dû enregistrer. Idempotent : rejouer le nettoyage ne change plus rien.
 */
export async function clearBouncedOpen(messageId: string, leadId: string): Promise<BounceCleanup> {
  const message = await prisma.campaignMessage.findUnique({
    where: { id: messageId },
    select: { id: true, openedAt: true, campaignId: true, stepPosition: true },
  });
  if (!message) return { openCleared: false, remainingOpens: 0, eventsRemoved: 0 };

  const openCleared = message.openedAt !== null;

  await prisma.campaignMessage.update({
    where: { id: messageId },
    data: { bouncedAt: new Date(), openedAt: null, openCount: 0 },
  });

  // Ce qui reste au lead APRÈS effacement : c'est cela qui décide du jalon et
  // de la frise.
  const remaining = await prisma.campaignMessage.findFirst({
    where: { leadId, openedAt: { not: null } },
    orderBy: { openedAt: 'desc' },
    select: { openedAt: true },
  });
  const remainingOpens = await prisma.campaignMessage.count({
    where: { leadId, openedAt: { not: null } },
  });

  await prisma.lead.update({
    where: { id: leadId },
    data: { lastOpenedAt: remaining?.openedAt ?? null },
  });

  // La frise : on vise LA ligne écrite par le pixel pour ce message — même
  // campagne, même étape, tel que le libellé la nomme. Les ouvertures des
  // autres étapes gardent la leur.
  let eventsRemoved = 0;
  if (openCleared) {
    const removed = await prisma.leadEvent.deleteMany({
      where: {
        leadId,
        type: 'email_opened',
        label: { contains: `(étape ${message.stepPosition})` },
        payload: { path: ['campaignId'], equals: message.campaignId },
      },
    });
    eventsRemoved = removed.count;

    // Libellé ou payload d'une autre forme (ligne ancienne) : à défaut de
    // viser juste, on n'efface que s'il ne reste AUCUNE ouverture au lead —
    // sinon on risquerait de supprimer une vraie.
    if (eventsRemoved === 0 && remainingOpens === 0) {
      const swept = await prisma.leadEvent.deleteMany({ where: { leadId, type: 'email_opened' } });
      eventsRemoved = swept.count;
    }
  }

  return { openCleared, remainingOpens, eventsRemoved };
}
