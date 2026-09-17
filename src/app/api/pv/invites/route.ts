// POST /api/pv/invites?token=<CRON_SECRET>
//
// Envoi en lot des invitations « 2 CV de bouchers ».
//
//   { "dealIds": ["..."], "dryRun": true }
//
// `dryRun` rend le mail sans l'envoyer : c'est l'aperçu, celui qu'on regarde
// avant d'écrire à un vrai directeur.
//
// GET /api/pv/invites?token=…&dealId=… — aperçu d'un seul magasin dans le
// navigateur.
//
// Pour envoyer à UN magasin depuis le CRM, la fiche affaire a un bouton :
// cf. /api/deals/[id]/pv-invite. Les deux passent par src/lib/pv/invitation.ts.

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedPvAdmin } from '@/lib/pv/auth';
import { pvConsultant } from '@/lib/pv/config';
import { prepareInvitation, previewInvitation, sendInvitation } from '@/lib/pv/invitation';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!isAuthorizedPvAdmin(req)) {
    return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  }

  let body: { dealIds?: unknown; dryRun?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Corps de requête illisible' }, { status: 400 });
  }

  const dealIds = Array.isArray(body.dealIds) ? body.dealIds.filter(id => typeof id === 'string') : [];
  if (dealIds.length === 0) {
    return NextResponse.json({ error: 'dealIds manquant' }, { status: 400 });
  }
  const dryRun = body.dryRun === true;

  const resultats: Array<Record<string, unknown>> = [];
  for (const dealId of dealIds as string[]) {
    try {
      const prep = await prepareInvitation(dealId);
      if (!prep.ok) {
        resultats.push({ dealId, ok: false, error: prep.error });
        continue;
      }

      if (dryRun) {
        const apercu = previewInvitation(prep);
        resultats.push({
          dealId,
          ok: true,
          dryRun: true,
          to: prep.destinataire,
          subject: apercu.subject,
          references: prep.references.length,
          nbProfils: prep.nbProfils,
          html: apercu.html,
        });
        continue;
      }

      resultats.push(await sendInvitation(prep));
    } catch (err) {
      console.error('[POST /api/pv/invites]', dealId, err);
      resultats.push({ dealId, ok: false, error: (err as Error).message });
    }
  }

  return NextResponse.json({
    consultant: pvConsultant().prenom,
    envoyes: resultats.filter(r => r.ok && !r.dryRun).length,
    echecs: resultats.filter(r => !r.ok).length,
    resultats,
  });
}

/** Aperçu d'un magasin, à ouvrir dans un navigateur. */
export async function GET(req: NextRequest) {
  if (!isAuthorizedPvAdmin(req)) {
    return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  }
  const prep = await prepareInvitation(req.nextUrl.searchParams.get('dealId') || '');
  if (!prep.ok) return NextResponse.json({ error: prep.error }, { status: 404 });

  return new NextResponse(previewInvitation(prep).html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
