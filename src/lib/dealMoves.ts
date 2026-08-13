// src/lib/dealMoves.ts
// Journalisation des déplacements d'affaires (table DealMove). Appelé par les
// TROIS chemins qui changent une affaire d'étape : le drag & drop du pipeline,
// le sélecteur d'étape de la fiche affaire et l'import CSV. Un chemin oublié =
// un trou silencieux dans l'historique.
import { prisma } from '@/lib/prisma';

export type DealMoveSource = 'pipeline' | 'fiche' | 'import';

interface RecordDealMoveArgs {
  dealId: string;
  /** Colonne quittée (null si inconnue, ex. affaire tout juste créée). */
  fromColumnId: string | null | undefined;
  toColumnId: string;
  userId?: string | null;
  userName?: string | null;
  source: DealMoveSource;
}

/**
 * Enregistre un déplacement. Volontairement « best-effort » : toute erreur est
 * avalée et tracée, car l'échec du journal ne doit JAMAIS faire échouer le
 * déplacement lui-même. Renvoie la ligne créée, ou null si rien n'a été écrit.
 */
export async function recordDealMove(args: RecordDealMoveArgs) {
  try {
    const { dealId, toColumnId, source } = args;
    const fromColumnId = args.fromColumnId ?? null;
    // Pas de mouvement réel (repositionnement dans la même colonne) → rien à
    // journaliser, sinon l'historique se remplit de faux déplacements.
    if (!dealId || !toColumnId || fromColumnId === toColumnId) return null;

    const ids = [fromColumnId, toColumnId].filter((v): v is string => !!v);
    const columns = await prisma.pipelineColumn.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, pipeline: { select: { id: true, name: true } } },
    });
    const from = columns.find(c => c.id === fromColumnId) ?? null;
    const to = columns.find(c => c.id === toColumnId) ?? null;

    // L'identité vient du navigateur : le compte peut avoir disparu depuis.
    // On retombe alors sur un mouvement anonyme plutôt que d'échouer sur la
    // contrainte de clé étrangère.
    let linkedUserId: string | null = null;
    if (args.userId) {
      const user = await prisma.user.findUnique({ where: { id: args.userId }, select: { id: true } });
      linkedUserId = user?.id ?? null;
    }

    return await prisma.dealMove.create({
      data: {
        dealId,
        fromColumnId,
        fromColumnTitle:  from?.title ?? '',
        fromPipelineId:   from?.pipeline?.id ?? null,
        fromPipelineName: from?.pipeline?.name ?? '',
        toColumnId,
        toColumnTitle:    to?.title ?? '',
        toPipelineId:     to?.pipeline?.id ?? null,
        toPipelineName:   to?.pipeline?.name ?? '',
        userId:   linkedUserId,
        userName: args.userName || '',
        source,
      },
    });
  } catch (err) {
    console.error('[recordDealMove]', err);
    return null;
  }
}
