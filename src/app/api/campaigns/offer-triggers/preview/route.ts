// src/app/api/campaigns/offer-triggers/preview/route.ts
//
//   POST /api/campaigns/offer-triggers/preview  { keywords, exclude, … }
//
// Ce que des termes attraperaient sur les offres déjà relevées, sans rien
// écrire. Sert deux fois : essayer des termes pendant qu'on écrit la règle, et
// chiffrer une reprise d'historique avant de la lancer.
//
// Écrire des termes à l'aveugle donne soit une règle qui ne se déclenche
// jamais, soit une règle qui attrape tout le magasin. L'aperçu enlève ce
// pari-là.

import { NextRequest, NextResponse } from 'next/server';
import { previewRule } from '@/lib/campaigns/offerTriggers';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });

  const keywords = String(body.keywords || '').trim();
  if (!keywords) return NextResponse.json({ matched: 0, distinctDeals: 0, sample: [] });

  try {
    const preview = await previewRule({
      keywords,
      exclude: String(body.exclude || ''),
      pipelineId: body.pipelineId ? String(body.pipelineId) : null,
      brandId: body.brandId ? String(body.brandId) : null,
      since: body.since ? new Date(String(body.since)) : null,
    });
    return NextResponse.json(preview);
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
