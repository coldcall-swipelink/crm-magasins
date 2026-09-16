// src/app/api/campaigns/offer-triggers/run/route.ts
//
//   POST /api/campaigns/offer-triggers/run            → toutes les règles actives
//   POST /api/campaigns/offer-triggers/run { id }     → une seule règle
//   POST /api/campaigns/offer-triggers/run { dryRun } → simulation, sans écrire
//   GET  …/run?secret=CRON_SECRET                     → même chose, pour le cron
//
// Le passage est aussi lancé automatiquement à la fin d'un import d'offres :
// c'est là que les nouvelles annonces arrivent, et une détection qui attend le
// prochain tour de cron fait perdre les heures qui comptent.
//
// Rejouable sans risque : une offre déjà passée devant une règle est
// enregistrée dans le journal, et la contrainte d'unicité l'empêche d'inscrire
// une seconde fois.

import { NextRequest, NextResponse } from 'next/server';
import { runOfferTriggers } from '@/lib/campaigns/offerTriggers';

export const dynamic = 'force-dynamic';
// Un import peut apporter plusieurs centaines d'offres d'un coup.
export const maxDuration = 300;

async function run(options: { triggerId?: string; dryRun?: boolean; userName?: string }) {
  const runs = await runOfferTriggers(options);
  return NextResponse.json({
    runs,
    // Totaux, pour que l'appelant (écran ou automatisation) n'ait pas à les
    // recalculer.
    enrolled: runs.reduce((sum, r) => sum + r.enrolled, 0),
    matched: runs.reduce((sum, r) => sum + r.matched, 0),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return run({
    triggerId: body?.id ? String(body.id) : undefined,
    dryRun: body?.dryRun === true,
    userName: body?.userName ? String(body.userName).trim() : undefined,
  });
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.nextUrl.searchParams.get('secret') !== secret) {
    return NextResponse.json({ error: 'Secret invalide' }, { status: 401 });
  }
  return run({});
}
