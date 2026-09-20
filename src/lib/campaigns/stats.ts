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
import { lastCronRun } from '@/lib/campaigns/engine';

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

/** Chiffres d'une variante A/B d'une étape (mêmes conventions que l'étape). */
export type VariantStats = {
  key: string;
  subject: string;
  sent: number;
  opened: number;
  replied: number;
  openRate: number;
  replyRate: number;
  /**
   * running : reçoit encore des envois · paused : en pause · kept : retenue à
   * la clôture du test · dropped : supprimée ou écartée à la clôture.
   */
  state: 'running' | 'paused' | 'kept' | 'dropped';
};

export type StepStats = {
  stepId: string;
  position: number;
  subject: string;
  sent: number;
  opened: number;
  replied: number;
  openRate: number;
  replyRate: number;
  /** Test A/B en cours sur cette étape. */
  testing: boolean;
  /**
   * Variantes ayant envoyé au moins un email, ou existant encore : vide hors
   * test et sans historique de test. Les lettres viennent des MESSAGES, pour
   * que la comparaison survive à la fin du test.
   */
  variants: VariantStats[];
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
    prisma.campaignStep.findMany({
      where: { campaignId }, orderBy: { position: 'asc' },
      include: { variants: { orderBy: { key: 'asc' } } },
    }),
    prisma.campaignEnrollment.count({
      where: { campaignId, status: 'active', nextSendAt: { lte: new Date() } },
    }),
  ]);

  // Trois agrégats par (étape, variante) suffisent pour toute la campagne :
  // l'étape se lit en sommant ses variantes, la lettre vide étant « hors test ».
  const sentScope = { campaignId, status: 'sent' };
  const [sentBy, openedBy, repliedBy] = await Promise.all([
    prisma.campaignMessage.groupBy({ by: ['stepId', 'variantKey'], where: sentScope, _count: { _all: true } }),
    prisma.campaignMessage.groupBy({ by: ['stepId', 'variantKey'], where: { ...sentScope, openedAt: { not: null } }, _count: { _all: true } }),
    prisma.campaignMessage.groupBy({ by: ['stepId', 'variantKey'], where: { ...sentScope, repliedAt: { not: null } }, _count: { _all: true } }),
  ]);
  const cell = (rows: Array<{ stepId: string | null; variantKey: string; _count: { _all: number } }>) =>
    new Map(rows.map(row => [`${row.stepId}|${row.variantKey}`, row._count._all]));
  const sentMap = cell(sentBy);
  const openMap = cell(openedBy);
  const replyMap = cell(repliedBy);

  const stepStats: StepStats[] = steps.map(step => {
    const keys = new Set<string>();
    for (const row of sentBy) if (row.stepId === step.id && row.variantKey) keys.add(row.variantKey);
    for (const variant of step.variants) keys.add(variant.key);

    const variants: VariantStats[] = Array.from(keys).sort().map(key => {
      const live = step.variants.find(variant => variant.key === key);
      const sent = sentMap.get(`${step.id}|${key}`) || 0;
      const opened = openMap.get(`${step.id}|${key}`) || 0;
      const replied = replyMap.get(`${step.id}|${key}`) || 0;
      const state: VariantStats['state'] = live
        ? (live.active ? 'running' : 'paused')
        : (step.abWinner === key ? 'kept' : 'dropped');
      return {
        key,
        // Après clôture, la variante gardée est devenue l'étape : son sujet
        // est encore lisible ; les autres n'ont plus de texte à montrer.
        subject: live?.subject ?? (state === 'kept' ? step.subject : ''),
        sent, opened, replied,
        openRate: rate(opened, sent), replyRate: rate(replied, sent),
        state,
      };
    });

    let sent = 0, opened = 0, replied = 0;
    for (const [id, count] of Array.from(sentMap)) if (id.startsWith(`${step.id}|`)) sent += count;
    for (const [id, count] of Array.from(openMap)) if (id.startsWith(`${step.id}|`)) opened += count;
    for (const [id, count] of Array.from(replyMap)) if (id.startsWith(`${step.id}|`)) replied += count;

    return {
      stepId: step.id, position: step.position, subject: step.subject,
      sent, opened, replied,
      openRate: rate(opened, sent), replyRate: rate(replied, sent),
      testing: step.variants.length > 0,
      variants,
    };
  });

  return {
    ...base,
    enrollments: Object.fromEntries(byStatus.map(row => [row.status, row._count._all])),
    stopReasons: Object.fromEntries(byReason.map(row => [row.stopReason || 'autre', row._count._all])),
    steps: stepStats,
    pending,
  };
}

export type DailyPoint = { date: string; sent: number; opened: number; replied: number };

/**
 * Ligne du tableau « campagne par campagne » de la vue d'ensemble.
 *
 * La progression mesure ce qui reste à envoyer : chaque inscription vaut
 * « étapes envoyées / étapes prévues », et une séquence arrêtée (réponse,
 * désinscription, adresse morte) compte comme terminée puisqu'elle n'a plus
 * rien à envoyer. 100 % = plus aucun envoi en attente.
 */
export type CampaignRow = {
  id: string;
  name: string;
  status: string;
  /** Date de création, ISO. */
  createdAt: string;
  /** Nombre d'étapes de la séquence. */
  steps: number;
  /** Leads inscrits, tous états confondus. */
  enrolled: number;
  /** Leads ayant reçu au moins un email. */
  contacted: number;
  /** Emails partis, relances comprises. */
  sent: number;
  /** 0–100, cf. ci-dessus. */
  progress: number;
  /** Leads qui ont reçu TOUTE la séquence (stopReason = completed). */
  completed: number;
  opened: number;
  openRate: number;
  replied: number;
  replyRate: number;
};

export type GlobalStats = Funnel & {
  campaigns: { total: number; running: number };
  mailboxes: Array<{ id: string; email: string; sentToday: number; sentTotal: number; active: boolean; lastError: string | null }>;
  daily: DailyPoint[];
  /** Toutes les campagnes, les actives d'abord, puis les plus contactées. */
  campaignRows: CampaignRow[];
  /**
   * Dernier passage AUTOMATIQUE du moteur (planificateur), ou null s'il n'a
   * jamais tourné. Les passages déclenchés à la main ne comptent pas : eux ne
   * disent rien sur le départ des relances.
   */
  lastRun: string | null;
};

/** Tableau de bord global de l'outil, sur les `days` derniers jours. */
export async function globalStats(days = 30): Promise<GlobalStats> {
  const since = new Date(Date.now() - days * 86_400_000);
  since.setHours(0, 0, 0, 0);

  const [base, campaigns, mailboxes, messages, lastRun] = await Promise.all([
    funnel(),
    prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, status: true, createdAt: true, _count: { select: { steps: true } } },
    }),
    prisma.mailbox.findMany({ orderBy: { createdAt: 'asc' } }),
    // Une seule lecture des messages récents : la courbe et les compteurs par
    // boîte s'en déduisent en mémoire, sans multiplier les requêtes.
    prisma.campaignMessage.findMany({
      where: { status: 'sent', sentAt: { gte: since } },
      select: { sentAt: true, openedAt: true, repliedAt: true, mailboxId: true, campaignId: true },
    }),
    lastCronRun(),
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

  const campaignRows = await campaignRowStats(campaigns);

  return {
    ...base,
    campaigns: {
      total: campaigns.length,
      running: campaigns.filter(row => row.status === 'running').length,
    },
    mailboxes: mailboxes.map(mailbox => ({
      id: mailbox.id,
      email: mailbox.email,
      active: mailbox.active,
      lastError: mailbox.lastError,
      sentToday: sentTodayBy.get(mailbox.id) || 0,
      sentTotal: totalBy.get(mailbox.id) || 0,
    })),
    daily: Array.from(buckets.values()),
    campaignRows,
    lastRun: lastRun ? lastRun.toISOString() : null,
  };
}

/**
 * Le tableau campagne par campagne : contactés, progression, séquences
 * complètes, ouvertures et réponses — avec les mêmes conventions que
 * l'entonnoir (ouverture sur les messages, réponse sur les leads).
 *
 * Sert la vue d'ensemble ET la liste des campagnes : les deux écrans montrent
 * ainsi les mêmes chiffres, calculés au même endroit.
 *
 * Tout se calcule en quelques agrégats groupés par campagne, puis se recoupe
 * en mémoire : le nombre de campagnes reste petit, pas celui des messages.
 */
export async function campaignRowStats(
  campaigns: Array<{ id: string; name: string; status: string; createdAt: Date; _count: { steps: number } }>,
): Promise<CampaignRow[]> {
  const sentScope = { status: 'sent' };
  const [sentBy, contactedBy, openedBy, repliedBy, enrollmentsBy, completedBy] = await Promise.all([
    prisma.campaignMessage.groupBy({ by: ['campaignId'], where: sentScope, _count: { _all: true } }),
    prisma.campaignMessage.groupBy({ by: ['campaignId', 'leadId'], where: sentScope }),
    prisma.campaignMessage.groupBy({
      by: ['campaignId'], where: { ...sentScope, openedAt: { not: null } }, _count: { _all: true },
    }),
    prisma.campaignMessage.groupBy({ by: ['campaignId', 'leadId'], where: { ...sentScope, repliedAt: { not: null } } }),
    prisma.campaignEnrollment.groupBy({
      by: ['campaignId', 'status'], _count: { _all: true }, _sum: { sentSteps: true },
    }),
    prisma.campaignEnrollment.groupBy({
      by: ['campaignId'], where: { stopReason: 'completed' }, _count: { _all: true },
    }),
  ]);

  const countBy = (rows: Array<{ campaignId: string; _count: { _all: number } }>) =>
    new Map(rows.map(row => [row.campaignId, row._count._all]));
  const leadsBy = (rows: Array<{ campaignId: string }>) => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.campaignId, (map.get(row.campaignId) || 0) + 1);
    return map;
  };

  const sentMap = countBy(sentBy);
  const contactedMap = leadsBy(contactedBy);
  const openMap = countBy(openedBy);
  const replyMap = leadsBy(repliedBy);
  const completedMap = countBy(completedBy);

  // Par campagne : inscrits, inscriptions déjà terminées (plus rien à envoyer)
  // et étapes déjà parties pour celles qui tournent encore.
  const enrollment = new Map<string, { total: number; over: number; running: number; runningSteps: number }>();
  for (const row of enrollmentsBy) {
    const acc = enrollment.get(row.campaignId) || { total: 0, over: 0, running: 0, runningSteps: 0 };
    const count = row._count._all;
    acc.total += count;
    if (row.status === 'finished' || row.status === 'stopped') acc.over += count;
    else { acc.running += count; acc.runningSteps += row._sum.sentSteps || 0; }
    enrollment.set(row.campaignId, acc);
  }

  const order = (status: string) => (status === 'running' ? 0 : status === 'paused' ? 1 : 2);

  return campaigns
    .map(campaign => {
      const steps = campaign._count.steps;
      const enr = enrollment.get(campaign.id) || { total: 0, over: 0, running: 0, runningSteps: 0 };
      // Les inscriptions en cours comptent au prorata des étapes parties ; on
      // borne au cas où des étapes auraient été supprimées après l'envoi.
      const runningShare = steps > 0 ? Math.min(enr.runningSteps, enr.running * steps) / steps : 0;
      const progress = enr.total > 0 ? Math.round(((enr.over + runningShare) / enr.total) * 100) : 0;
      const sent = sentMap.get(campaign.id) || 0;
      const contacted = contactedMap.get(campaign.id) || 0;
      const opened = openMap.get(campaign.id) || 0;
      const replied = replyMap.get(campaign.id) || 0;
      return {
        id: campaign.id, name: campaign.name, status: campaign.status,
        createdAt: campaign.createdAt.toISOString(),
        steps, enrolled: enr.total, contacted, sent, progress,
        completed: completedMap.get(campaign.id) || 0,
        opened, openRate: rate(opened, sent),
        replied, replyRate: rate(replied, contacted),
      };
    })
    .sort((a, b) => order(a.status) - order(b.status) || b.contacted - a.contacted);
}
