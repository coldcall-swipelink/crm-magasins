// src/app/api/offer-inbox/decide/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { decideInboxOffers } from '@/lib/import/offerInbox';

/**
 * Tri des offres reçues : ce que l'utilisateur a coché dans la popup.
 *
 *   POST /api/offer-inbox/decide
 *   { "importIds": ["…"], "rejectIds": ["…"], "decidedBy": "Bilal" }
 *
 * Les offres de `importIds` passent par l'import normal (mêmes règles que le
 * CSV : dédup magasin, nouvelle offre → retour en « À appeler ») ; celles de
 * `rejectIds` sont écartées. Ce qui n'est cité nulle part reste en attente —
 * un tri partiel est donc possible.
 */
export const dynamic = 'force-dynamic';

// L'import peut porter sur plusieurs dizaines d'offres (une transaction par
// ligne) : même marge que l'import CSV côté serveur.
export const maxDuration = 60;

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string' && !!x) : [];
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const importIds = ids(body?.importIds);
    const rejectIds = ids(body?.rejectIds);

    if (importIds.length === 0 && rejectIds.length === 0) {
      return NextResponse.json({ error: 'Aucune offre sélectionnée.' }, { status: 400 });
    }

    const decidedBy = typeof body?.decidedBy === 'string' && body.decidedBy.trim()
      ? body.decidedBy.trim()
      : 'CRM';

    const result = await decideInboxOffers(importIds, rejectIds, decidedBy);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[POST /api/offer-inbox/decide]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
