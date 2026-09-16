// src/lib/campaigns/stats.ts
//
// Chiffres des tableaux de bord : un global, un par campagne.
//
// Conventions retenues, pour que les taux veuillent dire quelque chose :
//   • « envoyés » compte les MESSAGES partis (relances comprises) ;
//   • « contactés » compte les LEADS touchés au moins une fois ;
//   • le taux d'ouverture se calcule sur les messages (un même lead peut
//     ouvrir la relance sans avoir ouvert le premier email) ;
//   • le taux de réponse se calcule sur les LEADS : c'est la seule lecture
//     commercialement utile — un lead qui répond deux fois n'est pas deux
//     prospects.
//
// Le suivi d'ouverture est déclaratif : pixel bloqué = ouverture invisible,
// pré-chargement d'image = ouverture comptée sans lecture. Le taux se lit
// comme une tendance, jamais comme une mesure exacte.

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { lastEngineRun } from '@/lib/campaigns/engine';

export type Funnel = {
  sent: number;
  contacted: number;
  opened: number;
  openedLeads: number;
  replied: number;
  bounced: number;
  failed: number;
  unsubscribed: number;
  openRate: number;
  replyRate: number;
  bounceRate: number;
};

function rate(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

/** Nombre de leads distincts vérifiant une condition sur leurs messages. */
async function distinctLeads(where: Prisma.CampaignMessageWhereInput): Promise<number> {
  const rows = await prisma.campaignMessage.groupBy({ by: ['leadId'], where });
  return rows.length;
}

/** Entonnoir d'un ensemble de messages (une campagne, ou tout l'outil). */
async function funnel(campaignId?: string): Promise<Funnel> {
  const scope = campaignId ? { campaignId } : {};
  const sentScope = { ...scope, status: 'sent' };

  const [sent, contacted, opened, openedLeads, repliedLeads, failed, bouncedLeads, unsubscribed] = await Promise.all([
    prisma.campaignMessage.count({ where: sentScope }),
    distinctLeads(sentScope),
    prisma.campaignMessage.count({ where: { ...sentScope, openedAt: { not: null } } }),
    distinctLeads({ ...sentScope, openedAt: { not: null } }),
    distinctLeads({ ...sentScope, repliedAt: { not: null } }),
    prisma.campaignMessage.count({ where: { ...scope, status: 'failed' } }),
    prisma.campaignEnrollment.count({
      where: { ...(campaignId ? { campaignId } : {}), stopReason: 'bounced' },
    }),
    prisma.campaignEnrollment.count({
      where: { ...(campaignId ? { campaignId } : {}), stopReason: 'unsubscribed' },
    }),
  ]);

  return {
    sent, contacted, opened, openedLeads,
    replied: repliedLeads,
    bounced: bouncedLeads,
    failed,
    unsubscribed,
    openRate: rate(opened, sent),
    replyRate: rate(repliedLeads, contacted),
    bounceRate: rate(bouncedLeads, contacted),
  };
}

export type StepStats = {
  stepId: string;
  position: number;
  subject: string;
  sent: number;
  opened: number;
  replied: number;
  openRate: number;
  replyRate: number;
};

export type CampaignStats = Funnel & {
  enrollments: Record<string, number>;
  stopReasons: Record<string, number>;
  steps: StepStats[];
  /** Inscriptions actives dont l'envoi est déjà dû : la file en attente. */
  pending: number;
};

/** Tableau de bord d'une campagne. */
export async function campaignStats(campaignId: string): Promise<CampaignStats> {
  const [base, byStatus, byReason, steps, pending] = await Promise.all([
    funnel(campaignId),
    prisma.campaignEnrollment.groupBy({ by: ['status'], where: { campaignId }, _count: { _all: true } }),
    prisma.campaignEnrollment.groupBy({ by: ['stopReason'], where: { campaignId, stopReason: { not: null } }, _count: { _all: true } }),
    prisma.campaignStep.findMany({ where: { campaignId }, orderBy: { position: 'asc' } }),
    prisma.campaignEnrollment.count({
      where: { campaignId, status: 'active', nextSendAt: { lte: new Date() } },
    }),
  ]);

  const stepStats: StepStats[] = await Promise.all(steps.map(async step => {
    const where = { campaignId, stepId: step.id, status: 'sent' };
    const [sent, opened, replied] = await Promise.all([
      prisma.campaignMessage.count({ where }),
      prisma.campaignMessage.count({ where: { ...where, openedAt: { not: null } } }),
      prisma.campaignMessage.count({ where: { ...where, repliedAt: { not: null } } }),
    ]);
    return {
      stepId: step.id, position: step.position, subject: step.subject,
      sent, opened, replied,
      openRate: rate(opened, sent), replyRate: rate(replied, sent),
    };
  }));

  return {
    ...base,
    enrollments: Object.fromEntries(byStatus.map(row => [row.status, row._count._all])),
    stopReasons: Object.fromEntries(byReason.map(row => [row.stopReason || 'autre', row._count._all])),
    steps: stepStats,
    pending,
  };
}

export type DailyPoint = { date: string; sent: number; opened: number; replied: number };

export type GlobalStats = Funnel & {
  campaigns: { total: number; running: number };
  leads: Record<string, number>;
  mailboxes: Array<{ id: string; email: string; sentToday: number; sentTotal: number; active: boolean; lastError: string | null }>;
  daily: DailyPoint[];
  topCampaigns: Array<{ id: string; name: string; status: string; sent: number; openRate: number; replyRate: number }>;
  /** Dernier passage du moteur d'envoi, ou null s'il n'a jamais tourné. */
  lastRun: string | null;
};

/** Tableau de bord global de l'outil, sur les `days` derniers jours. */
export async function globalStats(days = 30): Promise<GlobalStats> {
  const since = new Date(Date.now() - days * 86_400_000);
  since.setHours(0, 0, 0, 0);

  const [base, campaignRows, leadRows, mailboxes, messages, lastRun] = await Promise.all([
    funnel(),
    prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, status: true },
    }),
    prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.mailbox.findMany({ orderBy: { createdAt: 'asc' } }),
    // Une seule lecture des messages récents : la courbe et les compteurs par
    // boîte s'en déduisent en mémoire, sans multiplier les requêtes.
    prisma.campaignMessage.findMany({
      where: { status: 'sent', sentAt: { gte: since } },
      select: { sentAt: true, openedAt: true, repliedAt: true, mailboxId: true, campaignId: true },
    }),
    lastEngineRun(),
  ]);

  // Courbe jour par jour, trous compris (un jour sans envoi vaut zéro).
  const buckets = new Map<string, DailyPoint>();
  for (let i = 0; i < days; i++) {
    const date = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    buckets.set(date, { date, sent: 0, opened: 0, replied: 0 });
  }
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const sentTodayBy = new Map<string, number>();

  for (const message of messages) {
    const key = message.sentAt.toISOString().slice(0, 10);
    const point = buckets.get(key);
    if (point) {
      point.sent++;
      if (message.openedAt) point.opened++;
      if (message.repliedAt) point.replied++;
    }
    if (message.mailboxId && message.sentAt >= startOfToday) {
      sentTodayBy.set(message.mailboxId, (sentTodayBy.get(message.mailboxId) || 0) + 1);
    }
  }

  const totalByMailbox = await prisma.campaignMessage.groupBy({
    by: ['mailboxId'], where: { status: 'sent' }, _count: { _all: true },
  });
  const totalBy = new Map(totalByMailbox.map(row => [row.mailboxId, row._count._all]));

  // Classement des campagnes : les plus actives d'abord.
  const sentByCampaign = await prisma.campaignMessage.groupBy({
    by: ['campaignId'], where: { status: 'sent' }, _count: { _all: true },
  });
  const openedByCampaign = await prisma.campaignMessage.groupBy({
    by: ['campaignId'], where: { status: 'sent', openedAt: { not: null } }, _count: { _all: true },
  });
  const repliedByCampaign = await prisma.campaignMessage.groupBy({
    by: ['campaignId'], where: { status: 'sent', repliedAt: { not: null } }, _count: { _all: true },
  });
  const sentMap = new Map(sentByCampaign.map(row => [row.campaignId, row._count._all]));
  const openMap = new Map(openedByCampaign.map(row => [row.campaignId, row._count._all]));
  const replyMap = new Map(repliedByCampaign.map(row => [row.campaignId, row._count._all]));

  return {
    ...base,
    campaigns: {
      total: campaignRows.length,
      running: campaignRows.filter(row => row.status === 'running').length,
    },
    leads: Object.fromEntries(leadRows.map(row => [row.status, row._count._all])),
    mailboxes: mailboxes.map(mailbox => ({
      id: mailbox.id,
      email: mailbox.email,
      active: mailbox.active,
      lastError: mailbox.lastError,
      sentToday: sentTodayBy.get(mailbox.id) || 0,
      sentTotal: totalBy.get(mailbox.id) || 0,
    })),
    daily: Array.from(buckets.values()),
    topCampaigns: campaignRows
      .map(row => {
        const sent = sentMap.get(row.id) || 0;
        return {
          id: row.id, name: row.name, status: row.status, sent,
          openRate: rate(openMap.get(row.id) || 0, sent),
          replyRate: rate(replyMap.get(row.id) || 0, sent),
        };
      })
      .sort((a, b) => b.sent - a.sent)
      .slice(0, 8),
    lastRun: lastRun ? lastRun.toISOString() : null,
  };
}
