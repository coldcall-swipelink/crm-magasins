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
import { isValidEmail, normalizeCivility, normalizeEmail } from '@/lib/campaigns/leadFields';

/** Ce qu'une affaire apporte à un lead. */
type DealLead = {
  dealId: string;
  email: string;
  civility: string;
  lastName: string;
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
};

export type DealImportReport = {
  created: number;
  updated: number;
  skipped: number;
  leadIds: string[];
};

/** Affaires à reprendre, mises à plat. Dédoublonnées sur l'email. */
async function collect(pipelineId?: string): Promise<{ all: DealLead[]; deals: number; withEmail: number }> {
  const scope = pipelineId ? { pipelineId } : {};
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
    select: {
      id: true, dealEmail: true, contactCivilite: true, contactLastName: true,
      contactPosition: true,
      store: { select: { name: true, city: true, brand: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const byEmail = new Map<string, DealLead>();
  let withEmail = 0;

  for (const deal of deals) {
    const email = normalizeEmail(deal.dealEmail);
    if (!isValidEmail(email)) continue;
    withEmail++;
    // Deux affaires peuvent porter le même contact (groupe de magasins) : la
    // plus récente l'emporte, c'est elle qu'on a saisie en dernier.
    if (byEmail.has(email)) continue;

    byEmail.set(email, {
      dealId: deal.id,
      email,
      civility: normalizeCivility(deal.contactCivilite || ''),
      lastName: (deal.contactLastName || '').trim(),
      company: (deal.store?.brand?.name || '').trim(),
      jobTitle: (deal.contactPosition || '').trim(),
      city: (deal.store?.city || '').trim(),
      store: (deal.store?.name || '').trim(),
    });
  }

  return { all: Array.from(byEmail.values()), deals: total, withEmail };
}

/** Ce que donnerait la reprise, sans rien écrire. */
export async function previewDealLeads(pipelineId?: string): Promise<DealImportPreview> {
  const { all, deals, withEmail } = await collect(pipelineId);

  const emails = all.map(item => item.email);
  const known = emails.length
    ? await prisma.lead.count({ where: { email: { in: emails } } })
    : 0;

  // Volume par pipeline, pour que le filtre affiche ses chiffres.
  const pipelines = await prisma.pipeline.findMany({
    orderBy: { position: 'asc' },
    select: {
      id: true, name: true,
      _count: { select: { deals: true } },
    },
  });

  return {
    deals,
    withEmail,
    unique: all.length,
    known,
    fresh: all.length - known,
    sample: all.slice(0, 5),
    pipelines: pipelines.map(p => ({ id: p.id, name: p.name, deals: p._count.deals })),
  };
}

/**
 * Reprend les contacts des affaires comme leads.
 *
 * `onlyNew` laisse les leads déjà connus strictement intacts — utile pour une
 * reprise régulière, où l'on ne veut ajouter que ce qui est apparu depuis.
 */
export async function importDealLeads(options: {
  pipelineId?: string;
  onlyNew?: boolean;
  userName?: string;
} = {}): Promise<DealImportReport> {
  const { all } = await collect(options.pipelineId);

  const batch = await prisma.leadImport.create({
    data: {
      filename: options.pipelineId ? 'CRM — affaires du pipeline' : 'CRM — toutes les affaires',
      mapping: {
        email: 'dealEmail', civility: 'contactCivilite', lastName: 'contactLastName',
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
          company: true, jobTitle: true, city: true, dealId: true,
        },
      });

      if (!existing) {
        const lead = await prisma.lead.create({
          data: {
            email: item.email,
            civility: item.civility || null,
            lastName: item.lastName || null,
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
      if (!existing.civility && item.civility) fill.civility = item.civility;
      if (!existing.lastName && item.lastName) fill.lastName = item.lastName;
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
