// src/lib/demoBooking.ts
// Règle du « booking de démo » : quand une affaire entre dans la colonne
// « DEMO PREVUE » du pipeline **Closing**, on horodate l'entrée dans
// Deal.demoBookedAt. Ce champ alimente la ligne festive du flux d'activité.
//
// Volontairement limité au pipeline Closing : la colonne « Démo prévue » du
// pipeline Prospection porte un libellé proche mais ne correspond pas au même
// moment commercial.
import { prisma } from '@/lib/prisma';

const CLOSING_PIPELINE = 'closing';

/** Normalise un libellé pour comparer sans casse ni accents (« Démo prévue » ≡ « DEMO PREVUE »). */
function normalize(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/** Vrai si (colonne, pipeline) désigne « DEMO PREVUE » dans le pipeline Closing. */
export function isClosingDemoColumn(columnTitle?: string | null, pipelineName?: string | null): boolean {
  return normalize(columnTitle) === 'demo prevue' && normalize(pipelineName) === CLOSING_PIPELINE;
}

/**
 * Horodate le booking si la colonne d'arrivée est « DEMO PREVUE » (Closing).
 * Chaque nouvelle entrée dans la colonne ÉCRASE le booking précédent : c'est la
 * dernière démo bookée qui fait foi.
 *
 * Best-effort, comme la journalisation des déplacements : une erreur ici ne doit
 * pas faire échouer le déplacement de l'affaire. Renvoie la date posée, ou null.
 */
export async function markDemoBookedIfNeeded(dealId: string, columnId: string): Promise<Date | null> {
  try {
    const column = await prisma.pipelineColumn.findUnique({
      where: { id: columnId },
      select: { title: true, pipeline: { select: { name: true } } },
    });
    if (!isClosingDemoColumn(column?.title, column?.pipeline?.name)) return null;

    const bookedAt = new Date();
    await prisma.deal.update({ where: { id: dealId }, data: { demoBookedAt: bookedAt } });
    return bookedAt;
  } catch (err) {
    console.error('[markDemoBookedIfNeeded]', err);
    return null;
  }
}
