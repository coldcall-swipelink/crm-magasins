// POST|GET /api/pv/follow-ups?token=<CRON_SECRET>
//
// Relance du lendemain : les magasins qui ont répondu aux questions du parcours
// sans choisir de créneau.
//
// Le critère est un événement `answer_*` — une réponse, donc un geste humain —
// et JAMAIS l'ouverture du mail : les Safe Links de Microsoft cliquent les liens
// à la place du destinataire, un clic ne prouve donc rien.

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedPvAdmin } from '@/lib/pv/auth';
import { runFollowUps } from '@/lib/pv/reminders';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function run(req: NextRequest) {
  if (!isAuthorizedPvAdmin(req)) {
    return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  }
  try {
    const rapport = await runFollowUps();
    return NextResponse.json({ ok: rapport.erreurs.length === 0, ...rapport });
  } catch (err) {
    console.error('[/api/pv/follow-ups]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export const POST = run;
export const GET = run;
