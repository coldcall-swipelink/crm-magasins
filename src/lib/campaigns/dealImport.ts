// src/lib/campaigns/dealImport.ts
//
// Reprise des contacts du CRM comme leads de prospection.
//
// Les affaires du pipeline portent déjà un contact identifié : l'enseigne, le
// magasin, l'email, la civilité et le nom de famille y sont saisis au fil des
// appels. Les ressaisir dans un CSV pour les prospecter par email serait une
// double saisie — et une double vérité dès la première correction.
//
// On les reprend donc directement, en gardant le lien : chaque lead créé ainsi
// porte l'identifiant de son affaire (`Lead.dealId`), posé dès le premier jour
// pour cet usage.
//
// Prudence volontaire sur les leads déjà connus : on complète les champs
// vides, on n'écrase jamais une valeur existante. Un nom corrigé à la main
// dans l'écran Leads survit à une reprise ultérieure.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isShortCivility, isValidEmail, normalizeCivility, normalizeEmail } from '@/lib/campaigns/leadFields';

/** Ce qu'une affaire apporte à un lead. */
type DealLead = {
  dealId: string;
  email: string;
  civility: string;
  lastName: string;
  contactCalling: string; // interlocuteur appelé, « Contact calling » du CRM
  company: string;      // enseigne
  jobTitle: string;     // fonction du contact
  city: string;
  store: string;        // nom du magasin → champ personnalisé {{magasin}}
};

export type DealImportPreview = {
  /** Affaires examinées (après filtre de pipeline). */
  deals: number;
  /** Affaires portant un email exploitable. */
  withEmail: number;
  /** Adresses distinctes : deux affaires peuvent partager un contact. */
  unique: number;
  /** Déjà présentes dans les leads. */
  known: number;
  /** Nouvelles. */
  fresh: number;
  /** Aperçu des premières lignes, tel qu'il sera importé. */
  sample: DealLead[];
  /** Pipelines disponibles, pour le filtre de l'écran. */
  pipelines: Array<{ id: string; name: string; deals: number }>;
  /** Enseignes disponibles dans le pipeline choisi, avec leur volume. */
  brands: Array<{ id: string; name: string; deals: number }>;
};

/** Périmètre d'une reprise : pipeline et/ou enseigne. */
export type DealScope = { pipelineId?: string; brandId?: string };

export type DealImportReport = {
  created: number;
  updated: number;
  skipped: number;
  leadIds: string[];
};

/**
 * Ce qu'on lit d'une affaire pour en faire un lead. Isolé pour que la reprise
 * en masse et la reprise d'une seule affaire (cf. ensureLeadForDeal) ne
 * puissent pas diverger : une colonne ajoutée ici l'est des deux côtés.
 */
const DEAL_SELECT = {
  id: true, dealEmail: true, contactCivilite: true, contactLastName: true,
  contactCalling: true, contactPosition: true,
  store: { select: { name: true, city: true, brand: { select: { name: true } } } },
} satisfies Prisma.DealSelect;

type SelectedDeal = {
  id: string;
  dealEmail: string;
  contactCivilite: string;
  contactLastName: string;
  contactCalling: string;
  contactPosition: string;
  store: { name: string; city: string; brand: { name: string } | null } | null;
};

/** Mise à plat d'une affaire. Renvoie null si l'adresse est inexploitable. */
function toDealLead(deal: SelectedDeal): DealLead | null {
  const email = normalizeEmail(deal.dealEmail);
  if (!isValidEmail(email)) return null;
  return {
    dealId: deal.id,
    email,
    civility: normalizeCivility(deal.contactCivilite || ''),
    lastName: (deal.contactLastName || '').trim(),
    contactCalling: (deal.contactCalling || '').trim(),
    company: (deal.store?.brand?.name || '').trim(),
    jobTitle: (deal.contactPosition || '').trim(),
    city: (deal.store?.city || '').trim(),
    store: (deal.store?.name || '').trim(),
  };
}

/** Affaires à reprendre, mises à plat. Dédoublonnées sur l'email. */
async function collect(filter: DealScope = {}): Promise<{ all: DealLead[]; deals: number; withEmail: number }> {
  const scope: Prisma.DealWhereInput = {
    ...(filter.pipelineId ? { pipelineId: filter.pipelineId } : {}),
    // L'enseigne n'est pas portée par l'affaire mais par son magasin.
    ...(filter.brandId ? { store: { brandId: filter.brandId } } : {}),
  };
  // Total des affaires du périmètre : c'est le dénominateur affiché à l'écran
  // (« 42 affaires avec email sur 310 »). Le compter à part évite de le
  // confondre avec le nombre d'affaires qui portent une adresse.
  const total = await prisma.deal.count({ where: scope });

  const deals = await prisma.deal.findMany({
    where: {
      ...scope,
      // Inutile de parcourir les affaires sans adresse : elles ne donneront
      // jamais de lead.
      dealEmail: { not: '' },
    },
    select: DEAL_SELECT,
    orderBy: { createdAt: 'desc' },
  });

  const byEmail = new Map<string, DealLead>();
  let withEmail = 0;

  for (const deal of deals) {
    const item = toDealLead(deal);
    if (!item) continue;
    withEmail++;
    // Deux affaires peuvent porter le même contact (groupe de magasins) : la
    // plus récente l'emporte, c'est elle qu'on a saisie en dernier.
    if (byEmail.has(item.email)) continue;
    byEmail.set(item.email, item);
  }

  return { all: Array.from(byEmail.values()), deals: total, withEmail };
}

/**
 * Enseignes présentes parmi les affaires exploitables.
 *
 * Calculées dans le pipeline choisi mais SANS le filtre d'enseigne : sinon la
 * liste se réduirait à l'enseigne sélectionnée et on ne pourrait plus en
 * changer. Prisma ne sachant pas grouper sur un champ de relation, on compte
 * en mémoire — le volume reste celui des affaires ayant une adresse.
 */
async function brandOptions(pipelineId?: string) {
  const rows = await prisma.deal.findMany({
    where: { ...(pipelineId ? { pipelineId } : {}), dealEmail: { not: '' } },
    select: { store: { select: { brandId: true, brand: { select: { name: true } } } } },
  });

  const tally = new Map<string, { id: string; name: string; deals: number }>();
  for (const row of rows) {
    const id = row.store?.brandId;
    const name = row.store?.brand?.name;
    if (!id || !name) continue;
    const entry = tally.get(id) ?? { id, name, deals: 0 };
    entry.deals++;
    tally.set(id, entry);
  }
  // Les enseignes les plus fournies d'abord : ce sont celles qu'on cherche.
  return Array.from(tally.values()).sort((a, b) => b.deals - a.deals || a.name.localeCompare(b.name));
}

/** Ce que donnerait la reprise, sans rien écrire. */
export async function previewDealLeads(filter: DealScope = {}): Promise<DealImportPreview> {
  const { all, deals, withEmail } = await collect(filter);

  const emails = all.map(item => item.email);
  const known = emails.length
    ? await prisma.lead.count({ where: { email: { in: emails } } })
    : 0;

  // Volume par pipeline, pour que le filtre affiche ses chiffres.
  const [pipelines, brands] = await Promise.all([
    prisma.pipeline.findMany({
      orderBy: { position: 'asc' },
      select: { id: true, name: true, _count: { select: { deals: true } } },
    }),
    brandOptions(filter.pipelineId),
  ]);

  return {
    deals,
    withEmail,
    unique: all.length,
    known,
    fresh: all.length - known,
    sample: all.slice(0, 5),
    pipelines: pipelines.map(p => ({ id: p.id, name: p.name, deals: p._count.deals })),
    brands,
  };
}

/**
 * Reprend les contacts des affaires comme leads.
 *
 * `onlyNew` laisse les leads déjà connus strictement intacts — utile pour une
 * reprise régulière, où l'on ne veut ajouter que ce qui est apparu depuis.
 */
export async function importDealLeads(options: DealScope & {
  onlyNew?: boolean;
  userName?: string;
} = {}): Promise<DealImportReport> {
  const { all } = await collect({ pipelineId: options.pipelineId, brandId: options.brandId });

  const batch = await prisma.leadImport.create({
    data: {
      filename: options.brandId || options.pipelineId
        ? 'CRM — affaires filtrées'
        : 'CRM — toutes les affaires',
      mapping: {
        email: 'dealEmail', civility: 'contactCivilite', lastName: 'contactLastName',
        contactCalling: 'contactCalling',
        company: 'store.brand.name', jobTitle: 'contactPosition', city: 'store.city',
        'custom:magasin': 'store.name',
      } as Prisma.InputJsonValue,
      total: all.length,
      userName: options.userName || null,
    },
  });

  const report: DealImportReport = { created: 0, updated: 0, skipped: 0, leadIds: [] };
  const events: Prisma.LeadEventCreateManyInput[] = [];
  const CHUNK = 25;

  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map(async item => {
      const custom = item.store ? { magasin: item.store } : {};
      const existing = await prisma.lead.findUnique({
        where: { email: item.email },
        select: {
          id: true, customFields: true, civility: true, lastName: true,
          contactCalling: true, company: true, jobTitle: true, city: true, dealId: true,
        },
      });

      if (!existing) {
        const lead = await prisma.lead.create({
          data: {
            email: item.email,
            civility: item.civility || null,
            lastName: item.lastName || null,
            contactCalling: item.contactCalling || null,
            company: item.company || null,
            jobTitle: item.jobTitle || null,
            city: item.city || null,
            customFields: custom as Prisma.InputJsonValue,
            source: 'CRM — affaires',
            importId: batch.id,
            dealId: item.dealId,
          },
          select: { id: true },
        });
        return { id: lead.id, outcome: 'created' as const };
      }

      if (options.onlyNew) return { id: existing.id, outcome: 'skipped' as const };

      // Complément seulement : jamais d'écrasement d'une valeur déjà là.
      const fill: Record<string, unknown> = {};
      // La civilité est complétée si elle manque, et RÉÉCRITE si elle porte
      // encore une abréviation d'une version précédente (« M. » → « Monsieur »).
      // C'est la seule valeur qu'on se permette de corriger : une civilité
      // saisie à la main ne prend pas ces formes-là.
      if ((!existing.civility || isShortCivility(existing.civility)) && item.civility) {
        fill.civility = item.civility;
      }
      if (!existing.lastName && item.lastName) fill.lastName = item.lastName;
      if (!existing.contactCalling && item.contactCalling) fill.contactCalling = item.contactCalling;
      if (!existing.company && item.company) fill.company = item.company;
      if (!existing.jobTitle && item.jobTitle) fill.jobTitle = item.jobTitle;
      if (!existing.city && item.city) fill.city = item.city;
      if (!existing.dealId) fill.dealId = item.dealId;

      const previous = (existing.customFields as Record<string, string>) || {};
      if (item.store && !previous.magasin) {
        fill.customFields = { ...previous, magasin: item.store } as Prisma.InputJsonValue;
      }

      if (Object.keys(fill).length === 0) return { id: existing.id, outcome: 'skipped' as const };

      await prisma.lead.update({ where: { id: existing.id }, data: fill });
      return { id: existing.id, outcome: 'updated' as const };
    }));

    for (const result of results) {
      report.leadIds.push(result.id);
      if (result.outcome === 'created') {
        report.created++;
        events.push({
          leadId: result.id, type: 'imported',
          label: "Repris depuis une affaire du CRM", userName: options.userName || null,
        });
      } else if (result.outcome === 'updated') {
        report.updated++;
        events.push({
          leadId: result.id, type: 'updated',
          label: "Complété depuis l'affaire du CRM", userName: options.userName || null,
        });
      } else {
        report.skipped++;
      }
    }
  }

  if (events.length) await prisma.leadEvent.createMany({ data: events });
  await prisma.leadImport.update({
    where: { id: batch.id },
    data: { created: report.created, updated: report.updated, skipped: report.skipped },
  });

  return report;
}

/**
 * Le lead d'une affaire, créé si besoin.
 *
 * Utilisé par les déclencheurs sur offres : quand une offre correspond à une
 * règle, il faut un lead à inscrire, et l'affaire n'en a pas toujours un — elle
 * n'est peut-être jamais passée par la reprise depuis le CRM. Plutôt que de
 * laisser la règle sans effet, on reprend l'affaire à ce moment-là, exactement
 * comme le ferait l'import.
 *
 * Renvoie `null` avec la raison quand c'est impossible (affaire sans adresse
 * exploitable) : l'appelant en fait une ligne de journal plutôt qu'une erreur.
 */
export async function ensureLeadForDeal(dealId: string, userName?: string): Promise<
  { leadId: string; created: boolean } | { leadId: null; reason: string }
> {
  // Rattachement explicite d'abord : c'est le lien posé par la reprise.
  const linked = await prisma.lead.findFirst({ where: { dealId }, select: { id: true } });
  if (linked) return { leadId: linked.id, created: false };

  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: DEAL_SELECT });
  if (!deal) return { leadId: null, reason: 'Affaire introuvable' };

  const item = toDealLead(deal);
  if (!item) {
    return { leadId: null, reason: "L'affaire n'a pas d'adresse email exploitable" };
  }

  // À défaut de rattachement, l'adresse : un lead importé d'un fichier porte
  // la même adresse que l'affaire sans jamais avoir été relié. On enregistre
  // le rattachement au passage.
  const byEmail = await prisma.lead.findUnique({ where: { email: item.email }, select: { id: true } });
  if (byEmail) {
    await prisma.lead.update({ where: { id: byEmail.id }, data: { dealId } }).catch(() => {});
    return { leadId: byEmail.id, created: false };
  }

  const lead = await prisma.lead.create({
    data: {
      email: item.email,
      civility: item.civility || null,
      lastName: item.lastName || null,
      contactCalling: item.contactCalling || null,
      company: item.company || null,
      jobTitle: item.jobTitle || null,
      city: item.city || null,
      customFields: (item.store ? { magasin: item.store } : {}) as Prisma.InputJsonValue,
      source: 'CRM — offre détectée',
      dealId: item.dealId,
      events: {
        create: {
          type: 'imported',
          label: "Repris depuis une affaire du CRM (offre détectée)",
          userName: userName || null,
        },
      },
    },
    select: { id: true },
  });
  return { leadId: lead.id, created: true };
}
