// src/lib/campaigns/leads.ts
//
// Import de leads en base.
//
// La description des leads (statuts, champs, correspondance des colonnes) vit
// dans src/lib/campaigns/leadFields.ts, réexporté ici : le code serveur peut
// donc continuer à tout prendre au même endroit, pendant que les composants
// React n'importent que la partie pure.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  LEAD_FIELDS, applyMapping, isValidEmail,
  type LeadInput, type LeadMapping,
} from '@/lib/campaigns/leadFields';

export * from '@/lib/campaigns/leadFields';

// ─── Import ───────────────────────────────────────────────────────────────

export type ImportOptions = {
  filename: string;
  mapping: LeadMapping;
  rows: Record<string, string>[];
  /** Étiquette de provenance rangée sur chaque lead (« Salon Franchise 2026 »). */
  source?: string;
  /** Faux = les leads déjà connus sont laissés strictement intacts. */
  updateExisting?: boolean;
  userName?: string;
};

export type ImportReport = {
  importId: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  /** Lignes écartées, avec leur numéro dans le fichier et la raison. */
  rejected: Array<{ line: number; email: string; reason: string }>;
  /**
   * Identifiants de tous les leads du fichier reconnus en base — créés, mis à
   * jour ou simplement retrouvés. C'est ce qui permet d'inscrire directement
   * un import dans une campagne : « importer ce fichier DANS cette campagne »
   * en une seule opération, au lieu d'importer puis de rechercher.
   */
  leadIds: string[];
};

/** Champs standard renseignés par la ligne (les vides ne sont pas écrits). */
function filledFields(input: LeadInput): Record<string, string> {
  const data: Record<string, string> = {};
  for (const field of LEAD_FIELDS) {
    if (field.key === 'email') continue;
    const value = (input as Record<string, unknown>)[field.key];
    if (typeof value === 'string' && value.trim()) data[field.key] = value.trim();
  }
  return data;
}

/**
 * Importe un lot de leads.
 *
 * Règles :
 *   • l'email est la clé — un lead déjà connu n'est jamais dupliqué ;
 *   • un doublon à l'intérieur du fichier ne compte qu'une fois (première
 *     occurrence, complétée par les valeurs non vides des suivantes) ;
 *   • une mise à jour ne remplace jamais une valeur existante par du vide, et
 *     ne touche ni au statut, ni au propriétaire, ni à l'historique ;
 *   • un lead désinscrit le reste : l'import ne le réveille pas.
 */
export async function importLeads(options: ImportOptions): Promise<ImportReport> {
  const { filename, mapping, rows, source, updateExisting = true, userName } = options;

  // 1. Lecture du fichier → leads dédoublonnés, lignes fautives mises de côté.
  const byEmail = new Map<string, LeadInput>();
  const rejected: ImportReport['rejected'] = [];

  rows.forEach((row, index) => {
    const line = index + 2; // +1 pour l'en-tête, +1 pour compter à partir de 1
    const input = applyMapping(row, mapping);
    if (!input.email) {
      rejected.push({ line, email: '', reason: 'Email absent' });
      return;
    }
    if (!isValidEmail(input.email)) {
      rejected.push({ line, email: input.email, reason: 'Email invalide' });
      return;
    }
    const existing = byEmail.get(input.email);
    if (!existing) { byEmail.set(input.email, input); return; }

    // Doublon interne : on complète les trous de la première occurrence.
    for (const [key, value] of Object.entries(filledFields(input))) {
      if (!(existing as Record<string, unknown>)[key]) (existing as Record<string, unknown>)[key] = value;
    }
    Object.assign(existing.customFields, { ...input.customFields, ...existing.customFields });
  });

  const inputs = Array.from(byEmail.values());

  const batch = await prisma.leadImport.create({
    data: {
      filename,
      mapping: mapping as Prisma.InputJsonValue,
      total: rows.length,
      userName: userName || null,
    },
  });

  // 2. Écriture, par paquets : une base distante n'aime pas 5 000 allers-retours
  //    lancés d'un coup, et un paquet trop gros dépasserait le temps d'exécution.
  const CHUNK = 25;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const events: Prisma.LeadEventCreateManyInput[] = [];
  const leadIds: string[] = [];

  for (let i = 0; i < inputs.length; i += CHUNK) {
    const chunk = inputs.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map(async input => {
      const fields = filledFields(input);
      const existing = await prisma.lead.findUnique({
        where: { email: input.email },
        select: { id: true, customFields: true },
      });

      if (!existing) {
        const lead = await prisma.lead.create({
          data: {
            email: input.email,
            ...fields,
            customFields: input.customFields as Prisma.InputJsonValue,
            source: source || filename,
            importId: batch.id,
          },
          select: { id: true },
        });
        return { id: lead.id, outcome: 'created' as const };
      }

      if (!updateExisting) return { id: existing.id, outcome: 'skipped' as const };

      // Mise à jour : uniquement ce que la ligne apporte, jamais d'effacement.
      const previousCustom = (existing.customFields as Record<string, string>) || {};
      await prisma.lead.update({
        where: { id: existing.id },
        data: {
          ...fields,
          customFields: { ...previousCustom, ...input.customFields } as Prisma.InputJsonValue,
          ...(source ? { source } : {}),
          importId: batch.id,
        },
      });
      return { id: existing.id, outcome: 'updated' as const };
    }));

    for (const result of results) {
      // Retenu quel que soit le sort de la ligne : un lead « ignoré » parce
      // qu'il existait déjà reste un lead que l'on veut pouvoir inscrire.
      leadIds.push(result.id);

      if (result.outcome === 'created') created++;
      else if (result.outcome === 'updated') updated++;
      else { skipped++; continue; }

      events.push({
        leadId: result.id,
        type: result.outcome === 'created' ? 'imported' : 'updated',
        label: result.outcome === 'created'
          ? `Importé depuis « ${filename} »`
          : `Mis à jour par l'import « ${filename} »`,
        userName: userName || null,
      });
    }
  }

  // Les lignes fautives comptent aussi comme écartées dans le bilan affiché.
  skipped += rejected.length;

  if (events.length) await prisma.leadEvent.createMany({ data: events });

  await prisma.leadImport.update({
    where: { id: batch.id },
    data: { created, updated, skipped },
  });

  return {
    importId: batch.id,
    total: rows.length,
    created,
    updated,
    skipped,
    // Bilan lisible : on ne renvoie pas 4 000 lignes fautives à l'écran.
    rejected: rejected.slice(0, 50),
    leadIds,
  };
}
