// src/app/api/campaigns/run/route.ts
//
//   POST /api/campaigns/run?token=<CRON_SECRET>
//
// Passage du moteur d'envoi : il fait partir tout ce qui peut partir
// maintenant, boîte par boîte, dans la limite de son budget de temps.
// Appelée par le cron déclaré dans vercel.json ; utilisable aussi depuis
// n'importe quel planificateur (N8N…) avec le même jeton.
//
// Rejouable sans risque : chaque inscription est réservée avant envoi, deux
// passages simultanés ne peuvent pas envoyer deux fois le même email.

import { NextRequest, NextResponse } from 'next/server';
import { runDueSends } from '@/lib/campaigns/engine';

export const dynamic = 'force-dynamic';
// Le moteur espace ses envois : il lui faut du temps, pas de la puissance.
export const maxDuration = 300;

function unauthorized(req: NextRequest): boolean {
  const provided = (req.nextUrl.searchParams.get('token')
    || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || req.headers.get('x-webhook-token')
    || '').trim();
  if (!provided) return true;
  const accepted = [process.env.CRON_SECRET, process.env.EMAIL_SYNC_TOKEN, process.env.OFFERS_WEBHOOK_TOKEN]
    .map(value => (value || '').trim())
    .filter(Boolean);
  return !accepted.includes(provided);
}

async function run(req: NextRequest) {
  if (unauthorized(req)) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });

  try {
    // On garde une marge sous maxDuration pour que la réponse parte avant que
    // la plateforme ne coupe la fonction.
    const result = await runDueSends({ budgetMs: 240_000 });
    return NextResponse.json({ ok: result.failed === 0, ...result });
  } catch (err) {
    console.error('[POST /api/campaigns/run]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) { return run(req); }
// Les crons de certaines plateformes n'émettent que des GET.
export async function GET(req: NextRequest) { return run(req); }
