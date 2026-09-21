// src/app/api/campaigns/sync-replies/relink/route.ts
//
//   POST /api/campaigns/sync-replies/relink  { apply? }
//
// Rattache les réponses DÉJÀ enregistrées au message auquel elles répondent,
// pour qu'elles comptent dans les taux de réponse. Appelée depuis la vue
// d'ensemble, sans jeton — comme la relève manuelle.
//
// Sans `apply`, elle se contente de compter : on voit ce qui serait fait avant
// de le faire.

import { NextRequest, NextResponse } from 'next/server';
import { relinkOrphanReplies } from '@/lib/campaigns/relinkReplies';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    const report = await relinkOrphanReplies({ apply: body?.apply === true });
    return NextResponse.json({ ok: true, applied: body?.apply === true, ...report });
  } catch (err) {
    console.error('[POST /api/campaigns/sync-replies/relink]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
