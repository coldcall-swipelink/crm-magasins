// src/lib/emailTemplateVariants.ts
//
// Validation des déclinaisons par enseigne d'un template d'email, partagée
// entre les routes de création et de modification.

import { prisma } from '@/lib/prisma';

/** Liste d'ids d'enseignes nettoyée : chaînes non vides, sans doublon. */
export function cleanBrandIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim()),
  ));
}

/**
 * Une enseigne ne peut avoir qu'UNE déclinaison par template : sinon la fiche
 * affaire ne saurait pas laquelle appliquer. Retourne le message d'erreur à
 * afficher, ou null si les enseignes demandées sont libres.
 */
export async function brandOverlapError(
  templateId: string,
  brandIds: string[],
  excludeVariantId?: string,
): Promise<string | null> {
  const siblings = await prisma.emailTemplateVariant.findMany({
    where: { templateId, ...(excludeVariantId ? { id: { not: excludeVariantId } } : {}) },
    select: { brandIds: true },
  });
  const taken = new Set(siblings.flatMap(v => v.brandIds));
  const conflicts = brandIds.filter(id => taken.has(id));
  if (conflicts.length === 0) return null;

  const brands = await prisma.brand.findMany({
    where: { id: { in: conflicts } }, select: { name: true },
  });
  const names = brands.map(b => b.name).join(', ') || 'Cette enseigne';
  return `${names} a déjà sa déclinaison pour ce template`;
}
