// src/app/api/campaigns/sync-replies/route.ts
//
//   POST /api/campaigns/sync-replies?token=<CRON_SECRET>
//   POST /api/campaigns/sync-replies?token=…&sinceDays=3   (rattrapage)
//
// Relève les boîtes d'envoi en IMAP et applique l'arrêt sur réponse. C'est le
// pendant indispensable du moteur d'envoi : sans ce passage, une campagne
// continuerait de relancer un lead qui a déjà répondu.

import { NextRequest, NextResponse } from 'next/server';
import { syncAllReplies } from '@/lib/campaigns/replies';

export const dynamic = 'force-dynamic';
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

  const sinceDays = Number(req.nextUrl.searchParams.get('sinceDays')) || undefined;
  try {
    const result = await syncAllReplies(sinceDays);
    const failed = result.reports.filter(report => report.error);
    return NextResponse.json({ ok: failed.length === 0, ...result });
  } catch (err) {
    console.error('[POST /api/campaigns/sync-replies]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) { return run(req); }
export async function GET(req: NextRequest) { return run(req); }
