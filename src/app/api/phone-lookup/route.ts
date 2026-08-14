// src/app/api/phone-lookup/route.ts
// Campagne de recherche automatique des numéros de magasins.
//
//   GET  → compteurs d'avancement (combien de magasins ont un numéro, combien
//          restent à chercher, combien attendent une validation).
//   POST → traite UN lot de magasins et rend la main. L'interface rappelle la
//          route tant que `remaining > 0` : la campagne est ainsi interruptible,
//          reprenable, et ne dépasse jamais le temps d'exécution d'une requête.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runPhoneLookupBatch, phoneLookupStats, type BatchScope } from '@/lib/phone/lookup';
import { USE_MOCK_DATA } from '@/lib/mockData';

export const dynamic = 'force-dynamic';
// Un lot peut enchaîner plusieurs requêtes Overpass (lentes par nature) :
// on demande le maximum de temps d'exécution disponible.
export const maxDuration = 300;

export async function GET() {
  if (USE_MOCK_DATA) {
    return NextResponse.json({ total: 0, withPhone: 0, pending: 0, toReview: 0, notFound: 0, googleConfigured: false });
  }
  try {
    return NextResponse.json(await phoneLookupStats(prisma));
  } catch (err) {
    console.error('[GET /api/phone-lookup]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (USE_MOCK_DATA) {
    return NextResponse.json({ error: 'Indisponible en mode démonstration' }, { status: 400 });
  }
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const scope: BatchScope =
      body.scope === 'echecs' || body.scope === 'tout' ? body.scope : 'nouveaux';

    const report = await runPhoneLookupBatch(prisma, {
      limit: typeof body.limit === 'number' ? body.limit : 25,
      scope,
      useGoogle: typeof body.useGoogle === 'boolean' ? body.useGoogle : undefined,
      dealsOnly: body.dealsOnly !== false,
    });

    return NextResponse.json(report);
  } catch (err) {
    console.error('[POST /api/phone-lookup]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
