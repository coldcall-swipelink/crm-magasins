// src/lib/campaigns/offerTriggers.ts
//
// Déclencheurs sur offres d'emploi : « quand une offre de boucher sort sur une
// affaire, inscris son contact dans la campagne dédiée aux bouchers ».
//
// Les offres relevées par l'import disent ce que le magasin cherche
// AUJOURD'HUI. C'est le meilleur moment pour l'aborder, et le sujet de l'email
// dépend du métier recherché — d'où une campagne par métier, et une règle qui
// les relie.
//
// Trois garanties, parce qu'une règle envoie de vrais emails à de vraies
// personnes sans que personne ne clique :
//
//   1. Une offre ne déclenche qu'UNE FOIS par règle. La contrainte d'unicité
//      (triggerId, jobOfferId) le tient au niveau de la base, pas seulement
//      dans le code : deux passages simultanés ne peuvent pas inscrire deux
//      fois.
//   2. Une règle ne regarde que les offres apparues APRÈS elle. Activer une
//      règle ne déclenche donc pas un envoi sur tout l'historique ; reprendre
//      l'historique est une action séparée et explicite.
//   3. Tout passage laisse une trace, y compris quand rien n'a été inscrit.
//      Une règle qui ne fait rien doit pouvoir dire pourquoi.
//
// L'inscription elle-même passe par enrollLeads, qui refuse déjà les
// désinscrits, les adresses mortes et les leads déjà inscrits.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ensureLeadForDeal } from '@/lib/campaigns/dealImport';
import { enrollLeads } from '@/lib/campaigns/engine';
import { matchOffer } from '@/lib/campaigns/offerMatch';

/** Offres examinées au plus par règle et par passage. */
const BATCH = 300;

export type TriggerRun = {
  triggerId: string;
  triggerName: string;
  /** Offres examinées. */
  examined: number;
  /** Offres correspondant aux termes. */
  matched: number;
  /** Leads inscrits dans la campagne. */
  enrolled: number;
  /** Leads créés au passage (l'affaire n'en avait pas). */
  leadsCreated: number;
  /** Correspondances sans inscription, par raison. */
  skipped: Record<string, number>;
  error?: string;
};

const OFFER_SELECT = {
  id: true, dealId: true, title: true, jobTitle: true, contractType: true,
  url: true, source: true, publishedAt: true, firstSeenAt: true,
  store: { select: { name: true } },
} satisfies Prisma.JobOfferSelect;

type ScannedOffer = Prisma.JobOfferGetPayload<{ select: typeof OFFER_SELECT }>;

type Rule = {
  id: string; name: string; keywords: string; exclude: string;
  campaignId: string; pipelineId: string | null; brandId: string | null;
  since: Date;
};

/**
 * Offres candidates d'une règle : dans son périmètre, apparues après elle, et
 * pas encore passées devant elle.
 *
 * `firstSeenAt` et non `lastSeenAt` : une offre déjà connue qu'un import
 * revoit n'est pas une nouvelle offre, et ne doit pas relancer de campagne.
 */
async function candidates(rule: Rule, seen: string[]): Promise<ScannedOffer[]> {
  const scope: Prisma.JobOfferWhereInput = {
    firstSeenAt: { gte: rule.since },
    ...(seen.length ? { id: { notIn: seen } } : {}),
    ...(rule.pipelineId || rule.brandId
      ? {
          deal: {
            ...(rule.pipelineId ? { pipelineId: rule.pipelineId } : {}),
            // L'enseigne est portée par le magasin, pas par l'affaire.
            ...(rule.brandId ? { store: { brandId: rule.brandId } } : {}),
          },
        }
      : {}),
  };

  return prisma.jobOffer.findMany({
    where: scope,
    select: OFFER_SELECT,
    // Les plus anciennes d'abord : si un passage est tronqué par BATCH, le
    // suivant reprend la file dans l'ordre au lieu de laisser un trou.
    orderBy: { firstSeenAt: 'asc' },
    take: BATCH,
  });
}

/**
 * Les variables d'email décrivant l'offre, rangées dans les champs
 * personnalisés du lead ({{offre}}, {{offre_url}}…).
 *
 * Volontairement ÉCRASÉES à chaque déclenchement, contrairement à la reprise
 * depuis le CRM qui ne complète que les champs vides : elles décrivent la
 * dernière offre en date, pas une donnée saisie à la main qu'il faudrait
 * protéger.
 */
function offerFields(offer: ScannedOffer): Record<string, string> {
  return {
    offre: offer.title || offer.jobTitle || '',
    offre_poste: offer.jobTitle || offer.title || '',
    offre_contrat: offer.contractType || '',
    offre_url: offer.url || '',
    offre_source: offer.source || '',
    offre_date: offer.publishedAt || '',
  };
}

/** Traite une offre correspondante. Renvoie l'issue à journaliser. */
async function applyMatch(rule: Rule, offer: ScannedOffer, userName?: string): Promise<{
  outcome: 'enrolled' | 'lead_created' | 'skipped' | 'failed';
  reason: string;
  leadId: string | null;
}> {
  const lead = await ensureLeadForDeal(offer.dealId, userName);
  if (lead.leadId === null) return { outcome: 'skipped', reason: lead.reason, leadId: null };

  // L'offre alimente les variables AVANT l'inscription : le premier email peut
  // partir dans la foulée, il doit déjà pouvoir citer l'annonce.
  const current = await prisma.lead.findUnique({
    where: { id: lead.leadId },
    select: { customFields: true },
  });
  const previous = (current?.customFields as Record<string, string>) || {};
  await prisma.lead.update({
    where: { id: lead.leadId },
    data: { customFields: { ...previous, ...offerFields(offer) } as Prisma.InputJsonValue },
  });

  try {
    const result = await enrollLeads(rule.campaignId, [lead.leadId]);
    if (result.enrolled > 0) {
      await prisma.leadEvent.create({
        data: {
          leadId: lead.leadId,
          type: 'enrolled',
          label: `Offre « ${offer.title || offer.jobTitle} » détectée par la règle « ${rule.name} »`,
          userName: userName || null,
        },
      });
      return {
        outcome: lead.created ? 'lead_created' : 'enrolled',
        reason: '',
        leadId: lead.leadId,
      };
    }
    // enrollLeads a ses propres refus (désinscrit, déjà inscrit, statut
    // bloquant) : on reprend sa raison telle quelle plutôt que d'en inventer
    // une, pour que le journal dise la vérité de l'inscription.
    const reason = Object.keys(result.reasons)[0] || 'Non inscrit';
    return { outcome: 'skipped', reason, leadId: lead.leadId };
  } catch (err) {
    // Campagne sans boîte d'envoi active, campagne supprimée… : l'offre est
    // marquée traitée avec sa raison, pour ne pas boucler à chaque passage.
    return {
      outcome: 'failed',
      reason: err instanceof Error ? err.message : String(err),
      leadId: lead.leadId,
    };
  }
}

/**
 * Fait passer les offres devant les règles.
 *
 * `triggerId` limite à une règle, `dryRun` n'écrit rien (simulation d'écran).
 * Sans argument : toutes les règles actives — c'est la forme appelée après un
 * import d'offres et par la route périodique.
 */
export async function runOfferTriggers(options: {
  triggerId?: string;
  dryRun?: boolean;
  userName?: string;
} = {}): Promise<TriggerRun[]> {
  const triggers = await prisma.offerTrigger.findMany({
    where: {
      ...(options.triggerId ? { id: options.triggerId } : { active: true }),
    },
    orderBy: { createdAt: 'asc' },
  });

  const runs: TriggerRun[] = [];

  for (const trigger of triggers) {
    const run: TriggerRun = {
      triggerId: trigger.id,
      triggerName: trigger.name,
      examined: 0, matched: 0, enrolled: 0, leadsCreated: 0, skipped: {},
    };
    runs.push(run);

    const rule: Rule = {
      id: trigger.id, name: trigger.name, keywords: trigger.keywords,
      exclude: trigger.exclude, campaignId: trigger.campaignId,
      pipelineId: trigger.pipelineId, brandId: trigger.brandId,
      since: trigger.since,
    };

    try {
      const hits = await prisma.offerTriggerHit.findMany({
        where: { triggerId: trigger.id },
        select: { jobOfferId: true },
      });
      const offers = await candidates(rule, hits.map(hit => hit.jobOfferId));
      run.examined = offers.length;

      for (const offer of offers) {
        if (!matchOffer(offer, rule).matched) continue;
        run.matched++;

        if (options.dryRun) continue;

        const result = await applyMatch(rule, offer, options.userName);
        if (result.outcome === 'enrolled' || result.outcome === 'lead_created') {
          run.enrolled++;
          if (result.outcome === 'lead_created') run.leadsCreated++;
        } else {
          const label = result.reason || result.outcome;
          run.skipped[label] = (run.skipped[label] || 0) + 1;
        }

        // Le journal est écrit dans tous les cas, y compris sur un refus : sans
        // lui, la même offre repasserait à chaque tour. `createMany` avec
        // skipDuplicates s'appuie sur la contrainte d'unicité, qui protège
        // contre deux passages simultanés.
        await prisma.offerTriggerHit.createMany({
          data: [{
            triggerId: trigger.id,
            jobOfferId: offer.id,
            dealId: offer.dealId,
            leadId: result.leadId,
            outcome: result.outcome,
            reason: result.reason,
            offerTitle: offer.title || offer.jobTitle || '',
            storeName: offer.store?.name || '',
          }],
          skipDuplicates: true,
        });
      }

      if (!options.dryRun) {
        await prisma.offerTrigger.update({
          where: { id: trigger.id },
          data: {
            lastRunAt: new Date(),
            matchedCount: { increment: run.matched },
            enrolledCount: { increment: run.enrolled },
          },
        });
      }
    } catch (err) {
      // Une règle qui tombe ne doit pas emporter les autres.
      run.error = err instanceof Error ? err.message : String(err);
      console.error(`[offerTriggers] règle « ${trigger.name} »`, err);
    }
  }

  return runs;
}

/**
 * Ce qu'une règle attraperait sur les offres DÉJÀ en base, historique compris.
 *
 * Sert à deux choses : essayer des termes avant d'enregistrer la règle, et
 * chiffrer une reprise d'historique avant de la lancer — on ne propose pas
 * d'inscrire trois cents contacts sans dire trois cents.
 */
export async function previewRule(rule: {
  keywords: string;
  exclude?: string;
  pipelineId?: string | null;
  brandId?: string | null;
  since?: Date | null;
}): Promise<{
  matched: number;
  distinctDeals: number;
  sample: Array<{ title: string; store: string; firstSeenAt: string }>;
}> {
  const where: Prisma.JobOfferWhereInput = {
    ...(rule.since ? { firstSeenAt: { gte: rule.since } } : {}),
    ...(rule.pipelineId || rule.brandId
      ? {
          deal: {
            ...(rule.pipelineId ? { pipelineId: rule.pipelineId } : {}),
            ...(rule.brandId ? { store: { brandId: rule.brandId } } : {}),
          },
        }
      : {}),
  };

  // La correspondance ne s'exprime pas en SQL (début de mot, sans accent) :
  // on lit les intitulés et on filtre en mémoire. Borné aux offres les plus
  // récentes, l'aperçu n'ayant pas à parcourir des années d'historique.
  const offers = await prisma.jobOffer.findMany({
    where,
    select: {
      dealId: true, title: true, jobTitle: true, firstSeenAt: true,
      store: { select: { name: true } },
    },
    orderBy: { firstSeenAt: 'desc' },
    take: 4000,
  });

  const deals = new Set<string>();
  const sample: Array<{ title: string; store: string; firstSeenAt: string }> = [];
  let matched = 0;

  for (const offer of offers) {
    if (!matchOffer(offer, { keywords: rule.keywords, exclude: rule.exclude }).matched) continue;
    matched++;
    deals.add(offer.dealId);
    if (sample.length < 8) {
      sample.push({
        title: offer.title || offer.jobTitle || '(sans intitulé)',
        store: offer.store?.name || '',
        firstSeenAt: offer.firstSeenAt.toISOString(),
      });
    }
  }

  return { matched, distinctDeals: deals.size, sample };
}

/**
 * Intitulés les plus fréquents, pour proposer des termes plutôt que de laisser
 * la page blanche. Comptés sur les offres récentes.
 */
export async function commonJobTitles(limit = 30): Promise<Array<{ title: string; count: number }>> {
  const rows = await prisma.jobOffer.groupBy({
    by: ['jobTitle'],
    _count: { _all: true },
    where: { jobTitle: { not: '' } },
    orderBy: { _count: { jobTitle: 'desc' } },
    take: limit,
  });
  return rows.map(row => ({ title: row.jobTitle, count: row._count._all }));
}
