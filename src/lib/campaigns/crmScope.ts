// src/lib/campaigns/crmScope.ts
//
// Périmètre CRM d'une recherche de leads : un pipeline, et des colonnes de ce
// pipeline — plusieurs à la fois.
//
// Un lead repris du CRM porte l'identifiant de son affaire (Lead.dealId). On
// traduit donc le périmètre en liste d'affaires concernées, puis on cherche
// les leads qui en viennent. Le détour par une liste d'identifiants tient au
// fait que Lead.dealId n'est pas une relation Prisma — poser une clé étrangère
// sur une colonne déjà remplie ferait échouer la synchronisation de schéma au
// moindre rattachement orphelin.
//
// Le filtre par colonnes est le garde-fou contre le double contact : on
// inscrit les leads des colonnes « à appeler », pas ceux déjà « en contact ».

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type CrmScope = { pipelineId?: string; columnIds?: string[] };

/** Identifiants nettoyés : chaînes non vides, sans doublon. « a,b » ou tableau. */
export function parseIds(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const ids = Array.from(new Set(raw.map(v => String(v).trim()).filter(Boolean)));
  return ids.length ? ids : undefined;
}

/**
 * Fragment de `where` à poser sur les leads pour ce périmètre. Vide si aucun
 * périmètre n'est demandé. Sans affaire dans le périmètre, `in: []` dit
 * franchement « aucun lead » au lieu d'aller chercher des leads qu'on
 * écarterait ensuite.
 */
export async function leadWhereForCrmScope(scope: CrmScope): Promise<Prisma.LeadWhereInput> {
  const columnIds = scope.columnIds?.filter(Boolean) ?? [];
  if (!scope.pipelineId && columnIds.length === 0) return {};

  const deals = await prisma.deal.findMany({
    where: {
      ...(scope.pipelineId ? { pipelineId: scope.pipelineId } : {}),
      ...(columnIds.length ? { columnId: { in: columnIds } } : {}),
    },
    select: { id: true },
  });
  return { dealId: { in: deals.map(deal => deal.id) } };
}
