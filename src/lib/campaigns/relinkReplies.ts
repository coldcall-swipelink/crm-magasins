// src/lib/campaigns/relinkReplies.ts
//
// Rattacher après coup les réponses déjà enregistrées.
//
// Le compteur d'une campagne se lit sur les MESSAGES marqués répondus. Une
// réponse dont les en-têtes ne désignaient aucun message d'origine était bien
// enregistrée dans la fiche du lead, mais ne marquait rien : elle ne comptait
// nulle part. Le correctif règle le cas pour les réponses à venir ; celles
// déjà en base, elles, restent orphelines — la déduplication les écarte d'un
// nouveau relevé, puisqu'elles existent déjà.
//
// Ce module les reprend une par une. À quel message rattacher une réponse ?
// Au DERNIER email parti à ce lead AVANT qu'elle n'arrive : c'est celui
// auquel il répond, sauf exception. Un message déjà marqué est laissé tel
// quel, ce qui rend l'opération rejouable sans rien fausser.

import { prisma } from '@/lib/prisma';

export type RelinkReport = {
  /** Réponses examinées. */
  examined: number;
  /** Messages nouvellement marqués « répondu ». */
  linked: number;
  /** Réponses dont le message était déjà marqué. */
  alreadyLinked: number;
  /** Réponses sans aucun email parti avant elles : rien à rattacher. */
  noMessage: number;
  /** Aperçu de ce qui a été rattaché, pour le compte rendu à l'écran. */
  samples: Array<{ lead: string; campaign: string; receivedAt: string }>;
};

export async function relinkOrphanReplies(options: { apply: boolean; limit?: number } = { apply: false }): Promise<RelinkReport> {
  const report: RelinkReport = { examined: 0, linked: 0, alreadyLinked: 0, noMessage: 0, samples: [] };

  const replies = await prisma.campaignReply.findMany({
    where: { leadId: { not: null } },
    orderBy: { receivedAt: 'asc' },
    take: options.limit ?? 2000,
    select: {
      id: true, leadId: true, campaignId: true, receivedAt: true,
      lead: { select: { email: true } },
    },
  });

  for (const reply of replies) {
    if (!reply.leadId) continue;
    report.examined++;

    // Le dernier email parti à ce lead avant la réponse. La borne de date
    // évite de marquer un email envoyé APRÈS coup — une relance partie entre
    // -temps n'est pas ce à quoi il a répondu.
    const message = await prisma.campaignMessage.findFirst({
      where: { leadId: reply.leadId, status: 'sent', sentAt: { lte: reply.receivedAt } },
      orderBy: { sentAt: 'desc' },
      select: { id: true, campaignId: true, repliedAt: true, campaign: { select: { name: true } } },
    });
    if (!message) { report.noMessage++; continue; }
    if (message.repliedAt) { report.alreadyLinked++; continue; }

    report.linked++;
    if (report.samples.length < 20) {
      report.samples.push({
        lead: reply.lead?.email ?? reply.leadId,
        campaign: message.campaign?.name ?? '—',
        receivedAt: reply.receivedAt.toISOString(),
      });
    }

    if (options.apply) {
      await prisma.campaignMessage.update({
        where: { id: message.id },
        data: { repliedAt: reply.receivedAt },
      });
      // La réponse gagne aussi sa campagne, pour que la fiche du lead et les
      // écrans de campagne la rangent au bon endroit.
      if (!reply.campaignId) {
        await prisma.campaignReply.update({
          where: { id: reply.id },
          data: { campaignId: message.campaignId },
        });
      }
    }
  }

  return report;
}
