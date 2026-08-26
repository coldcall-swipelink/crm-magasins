import { NextRequest, NextResponse } from 'next/server';
import { syncAllMailboxes, isImapConfigured } from '@/lib/emailInbox';

// Relevé IMAP des boîtes @swipelink.fr : récupère les réponses des contacts et
// les journalise dans les affaires. À déclencher de l'extérieur (N8N, cron de
// l'hébergeur) toutes les 5 à 15 minutes :
//
//   POST /api/emails/sync-replies?token=<EMAIL_SYNC_TOKEN>
//
// Paramètre optionnel `days` : relit les messages des N derniers jours au lieu
// de repartir du curseur. Sert au rattrapage initial (le premier relevé pose
// seulement le curseur, sans rien importer, pour ne pas déverser tout
// l'historique des boîtes dans les affaires). La déduplication par Message-ID
// rend l'opération rejouable sans créer de doublon.
//
//   POST /api/emails/sync-replies?token=…&days=7
export const dynamic = 'force-dynamic';

// Le relevé ouvre une connexion IMAP par boîte : on laisse de la marge.
export const maxDuration = 60;

function unauthorized(req: NextRequest): boolean {
  const expected = (process.env.EMAIL_SYNC_TOKEN || '').trim();
  // Sans jeton configuré, la route reste fermée : elle lit des boîtes mail.
  if (!expected) return true;
  const provided = req.nextUrl.searchParams.get('token')
    || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || '';
  return provided !== expected;
}

async function run(req: NextRequest) {
  if (unauthorized(req)) {
    return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  }
  if (!isImapConfigured()) {
    return NextResponse.json(
      { error: 'Aucune boîte configurée (voir IMAP_PASSWORD_* dans .env)' },
      { status: 400 },
    );
  }

  const daysParam = req.nextUrl.searchParams.get('days');
  const days = daysParam ? Number(daysParam) : undefined;
  if (daysParam && (!Number.isFinite(days) || (days as number) <= 0)) {
    return NextResponse.json({ error: 'Paramètre `days` invalide' }, { status: 400 });
  }

  try {
    const reports = await syncAllMailboxes(days);
    const total = reports.reduce(
      (acc, r) => ({
        scanned: acc.scanned + r.scanned,
        recorded: acc.recorded + r.recorded,
        duplicates: acc.duplicates + r.duplicates,
        unmatched: acc.unmatched + r.unmatched,
      }),
      { scanned: 0, recorded: 0, duplicates: 0, unmatched: 0 },
    );
    const failed = reports.filter(r => r.error);
    return NextResponse.json({ ok: failed.length === 0, total, mailboxes: reports });
  } catch (err) {
    console.error('[POST /api/emails/sync-replies]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return run(req);
}

// GET accepté pour les ordonnanceurs qui ne savent pas faire de POST.
export async function GET(req: NextRequest) {
  return run(req);
}
