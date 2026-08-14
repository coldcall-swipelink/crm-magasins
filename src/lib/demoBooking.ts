// src/lib/demoBooking.ts
// Historique des démos bookées. Quand une affaire entre dans la colonne
// « DEMO PREVUE » du pipeline **Closing**, on crée une ligne DemoBooking —
// exactement comme le compteur d'appels crée une ligne CallLog par appel.
// Rebooker une démo AJOUTE une ligne : rien n'est écrasé, chaque booking garde
// son auteur, sa date de booking, sa date de démo et son indicateur no-show.
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

interface DemoBookingAuthor {
  userId?: string | null;
  userName?: string | null;
}

/**
 * Enregistre un booking de démo si la colonne d'arrivée est « DEMO PREVUE »
 * (Closing) : une ligne DemoBooking de plus, plus le miroir Deal.demoBookedAt.
 *
 * Best-effort, comme la journalisation des déplacements : une erreur ici ne doit
 * pas faire échouer le déplacement de l'affaire. Renvoie la ligne créée, ou null.
 */
export async function markDemoBookedIfNeeded(dealId: string, columnId: string, author: DemoBookingAuthor = {}) {
  try {
    const column = await prisma.pipelineColumn.findUnique({
      where: { id: columnId },
      select: { title: true, pipeline: { select: { name: true } } },
    });
    if (!isClosingDemoColumn(column?.title, column?.pipeline?.name)) return null;

    const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { demoDate: true } });
    if (!deal) return null;

    const bookedAt = new Date();
    // Date de démo à l'instant du booking. Une date déjà passée appartient à la
    // démo précédente (cas du rebooking) : on repart de zéro, la fiche affichera
    // « date de démo à renseigner » jusqu'à la saisie de la nouvelle date.
    const demoDate = deal.demoDate && deal.demoDate.getTime() > bookedAt.getTime() ? deal.demoDate : null;

    // L'identité vient du navigateur : le compte peut avoir disparu depuis. On
    // retombe alors sur un booking anonyme plutôt que d'échouer sur la clé étrangère.
    let linkedUserId: string | null = null;
    if (author.userId) {
      const user = await prisma.user.findUnique({ where: { id: author.userId }, select: { id: true } });
      linkedUserId = user?.id ?? null;
    }

    const booking = await prisma.demoBooking.create({
      data: {
        dealId,
        userId: linkedUserId,
        userName: author.userName || '',
        bookedAt,
        demoDate,
      },
    });
    await prisma.deal.update({ where: { id: dealId }, data: { demoBookedAt: bookedAt } });
    return booking;
  } catch (err) {
    console.error('[markDemoBookedIfNeeded]', err);
    return null;
  }
}

/**
 * Reporte la date de démo saisie sur la fiche vers le booking le plus récent de
 * l'affaire : la date de démo est presque toujours renseignée APRÈS le
 * déplacement dans « DEMO PREVUE ». Les bookings antérieurs ne bougent pas :
 * ils gardent la date de la démo qu'ils ont réellement produite.
 *
 * Uniquement tant que l'affaire est ENCORE dans « DEMO PREVUE » : une fois la
 * démo passée (l'affaire a changé d'étape), la date du booking est un fait
 * historique qu'une modification tardive de la fiche ne doit pas réécrire.
 *
 * Best-effort. Renvoie true si une ligne a été mise à jour.
 */
export async function syncLatestDemoBookingDate(dealId: string, demoDate: Date | null): Promise<boolean> {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { column: { select: { title: true, pipeline: { select: { name: true } } } } },
    });
    if (!isClosingDemoColumn(deal?.column?.title, deal?.column?.pipeline?.name)) return false;

    const latest = await prisma.demoBooking.findFirst({
      where: { dealId },
      orderBy: { bookedAt: 'desc' },
      select: { id: true },
    });
    if (!latest) return false;
    await prisma.demoBooking.update({ where: { id: latest.id }, data: { demoDate } });
    return true;
  } catch (err) {
    console.error('[syncLatestDemoBookingDate]', err);
    return false;
  }
}
