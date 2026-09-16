// POST|GET /api/pv/reminders?token=<CRON_SECRET>
//
// Passage des rappels de démo : la veille, puis 1 h avant. E-mail et SMS.
// Déclenché par le cron de vercel.json, toutes les 10 minutes.
//
// Rejouable sans risque : chaque rappel est marqué en base avant de partir.

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedPvAdmin } from '@/lib/pv/auth';
import { runDemoReminders } from '@/lib/pv/reminders';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function run(req: NextRequest) {
  if (!isAuthorizedPvAdmin(req)) {
    return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  }
  try {
    const rapport = await runDemoReminders();
    return NextResponse.json({ ok: rapport.erreurs.length === 0, ...rapport });
  } catch (err) {
    console.error('[/api/pv/reminders]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export const POST = run;
// Les planificateurs de Vercel appellent en GET : les deux verbes font la même
// chose, l'opération étant idempotente.
export const GET = run;
