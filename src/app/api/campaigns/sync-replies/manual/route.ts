// src/app/api/campaigns/sync-replies/manual/route.ts
//
//   POST /api/campaigns/sync-replies/manual  { sinceDays? }
//
// Relève des réponses DÉCLENCHÉE DEPUIS L'INTERFACE, par le bouton de la vue
// d'ensemble. Pourquoi une route à part de /api/campaigns/sync-replies : celle
// -là est appelée par le planificateur et exige `CRON_SECRET`. Or ce secret
// est marqué confidentiel chez l'hébergeur — il n'est plus relisible une fois
// posé, et il n'a de toute façon rien à faire dans le paquet envoyé au
// navigateur. Même raisonnement que la route de réparation de schéma, appelée
// elle aussi depuis un écran.
//
// Elle ne fait rien de plus que la relève ordinaire : lire les boîtes, et
// rattacher réponses et rejets. Aucune écriture qu'un passage automatique ne
// ferait pas de lui-même quelques minutes plus tard.

import { NextRequest, NextResponse } from 'next/server';
import { syncAllReplies } from '@/lib/campaigns/replies';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Au-delà, la relève dépasserait le temps imparti à la fonction. */
const MAX_DAYS = 90;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const asked = Number(body?.sinceDays);
  // Sans fenêtre : relève ordinaire, depuis le dernier passage. Avec : on
  // relit tout ce qui est arrivé depuis, pour rattraper ce qu'une ancienne
  // version n'avait pas su rattacher.
  const sinceDays = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_DAYS) : undefined;

  try {
    const result = await syncAllReplies(sinceDays);
    const failed = result.reports.filter(report => report.error);
    const total = result.reports.reduce(
      (sum, report) => ({
        scanned: sum.scanned + report.scanned,
        replies: sum.replies + report.replies,
        bounces: sum.bounces + report.bounces,
        stopped: sum.stopped + report.stopped,
        unmatched: sum.unmatched + report.unmatched,
      }),
      { scanned: 0, replies: 0, bounces: 0, stopped: 0, unmatched: 0 },
    );
    return NextResponse.json({ ok: failed.length === 0, sinceDays: sinceDays ?? null, total, reports: result.reports });
  } catch (err) {
    console.error('[POST /api/campaigns/sync-replies/manual]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
