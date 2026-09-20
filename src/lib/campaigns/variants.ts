// src/lib/campaigns/variants.ts
//
// Tests A/B sur une étape de séquence.
//
// Une étape « en test » porte plusieurs variantes (A, B, C, D) : même délai,
// même fil de discussion, même modèle du CRM — seuls le sujet et le corps
// changent. À chaque envoi, le moteur tire une variante ACTIVE et note sa
// lettre sur le message ; les statistiques comparent ensuite les lettres.
//
// Ce qui vit ici est partagé par le moteur, les routes et les statistiques,
// pour que « quelle variante part ? » et « cette étape peut-elle partir ? »
// aient une seule réponse dans tout l'outil.

import type { CampaignStep, CampaignStepVariant } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** Lettres disponibles, dans l'ordre d'attribution. */
export const VARIANT_KEYS = ['A', 'B', 'C', 'D'] as const;
export const MAX_VARIANTS = VARIANT_KEYS.length;

/** Le contenu qui varie d'une version à l'autre. */
export type VariantContent = {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  useHtml: boolean;
};

export type StepWithVariants = CampaignStep & { variants: CampaignStepVariant[] };

/** Première lettre libre, ou null si l'étape est pleine. */
export function nextVariantKey(existing: Array<{ key: string }>): string | null {
  const used = new Set(existing.map(variant => variant.key));
  return VARIANT_KEYS.find(key => !used.has(key)) ?? null;
}

/**
 * Un contenu est-il envoyable ?
 *
 * Une étape à modèle du CRM n'a rien à rédiger : le sujet, s'il est vide,
 * vient du modèle. Une étape libre exige un sujet ET un corps — sans quoi le
 * lead recevrait un email vide, ce qui est pire que rien.
 */
export function contentIsUsable(step: Pick<CampaignStep, 'templateKey'>, content: VariantContent): boolean {
  if (step.templateKey) return true;
  return Boolean(content.subject.trim() && (content.useHtml ? content.bodyHtml.trim() : content.bodyText.trim()));
}

/** Les variantes d'une étape qui peuvent partir : actives et rédigées. */
export function sendableVariants(step: StepWithVariants): CampaignStepVariant[] {
  return step.variants.filter(variant => variant.active && contentIsUsable(step, variant));
}

/**
 * L'étape peut-elle envoyer quelque chose ?
 *
 * Hors test, c'est le contenu de l'étape qui compte. En test, il faut au moins
 * une variante envoyable : le contenu de l'étape est alors ignoré par le
 * moteur, il ne doit pas non plus compter ici — sinon on lancerait une
 * campagne dont toutes les variantes sont vides.
 */
export function stepIsUsable(step: StepWithVariants): boolean {
  if (step.variants.length === 0) return contentIsUsable(step, step);
  return sendableVariants(step).length > 0;
}

/**
 * Tire la variante à envoyer pour cette étape, ou null hors test.
 *
 * Répartition : la variante la moins envoyée jusqu'ici passe en premier, et
 * l'égalité se départage au hasard. On obtient ainsi des volumes équilibrés
 * dès les premiers envois — ce qu'un tirage purement aléatoire ne garantit
 * pas sur trente leads — sans jamais figer un ordre qui pourrait recouper
 * celui des inscriptions.
 *
 * Une variante mise en pause ou laissée vide ne reçoit rien. S'il n'en reste
 * aucune d'envoyable, on renvoie null : l'appelant écarte le lead plutôt que
 * d'envoyer le contenu de l'étape, qui n'est plus celui que l'on teste.
 */
export async function pickVariant(step: StepWithVariants): Promise<CampaignStepVariant | null | undefined> {
  if (step.variants.length === 0) return undefined;
  const candidates = sendableVariants(step);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const counts = await prisma.campaignMessage.groupBy({
    by: ['variantKey'],
    where: { stepId: step.id, status: 'sent' },
    _count: { _all: true },
  });
  const sentBy = new Map(counts.map(row => [row.variantKey, row._count._all]));

  const least = Math.min(...candidates.map(variant => sentBy.get(variant.key) ?? 0));
  const tied = candidates.filter(variant => (sentBy.get(variant.key) ?? 0) === least);
  return tied[Math.floor(Math.random() * tied.length)];
}

/** Libellé court d'une variante, pour les écrans et les journaux. */
export function variantLabel(key: string): string {
  return key ? `Variante ${key}` : '';
}
