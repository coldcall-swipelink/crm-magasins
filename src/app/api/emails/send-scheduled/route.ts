// src/app/api/emails/send-scheduled/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { sendDueEmails } from '@/lib/scheduledEmails';

/**
 * Départ des emails programmés depuis le CRM (« envoyer demain à 9h »).
 *
 *   POST /api/emails/send-scheduled?token=<EMAIL_SYNC_TOKEN>
 *   (jeton aussi accepté en « Authorization: Bearer … »)
 *
 * À brancher sur le planificateur (N8N, cron de l'hébergeur) toutes les 5 à
 * 15 minutes : c'est lui qui garantit le départ quand personne n'est devant le
 * CRM. L'ouverture d'une fiche affaire relève également la file, mais on ne
 * peut pas compter dessus à 9h du matin.
 *
 * Rejouable : chaque email est réservé avant envoi, un passage concurrent ne
 * peut pas le faire partir deux fois.
 *
 * Sans jeton configuré, la route reste fermée (elle envoie des emails).
 * À défaut d'EMAIL_SYNC_TOKEN, OFFERS_WEBHOOK_TOKEN est accepté : les deux
 * servent au même planificateur.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function unauthorized(req: NextRequest): boolean {
  const expected = (process.env.EMAIL_SYNC_TOKEN || process.env.OFFERS_WEBHOOK_TOKEN || '').trim();
  if (!expected) return true;
  const provided = req.nextUrl.searchParams.get('token')
    || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || req.headers.get('x-webhook-token')
    || '';
  return provided !== expected;
}

async function run(req: NextRequest) {
  if (unauthorized(req)) {
    return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  }
  try {
    const result = await sendDueEmails();
    // 503 quand rien n'a pu être tenté : le planificateur doit pouvoir le voir
    // passer plutôt que de croire la file vide.
    return NextResponse.json(
      { ok: !result.blocked && result.failed === 0, ...result },
      { status: result.blocked ? 503 : 200 },
    );
  } catch (err) {
    console.error('[POST /api/emails/send-scheduled]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) { return run(req); }
// GET accepté pour les ordonnanceurs qui ne savent pas faire de POST.
export async function GET(req: NextRequest) { return run(req); }
