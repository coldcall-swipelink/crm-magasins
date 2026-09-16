// POST /api/pv/events
//
// Suivi anonyme de l'entonnoir : page_view, answer_1..3, email_edit,
// slot_select, booking_ok, booking_err, callback_open, callback_ok.
//
// Envoyé par navigator.sendBeacon : la requête part parfois au moment où
// l'onglet se ferme, sans que personne n'attende la réponse. D'où deux
// particularités :
//   • on répond 204, le plus court possible ;
//   • une erreur ne remonte jamais au visiteur — un événement perdu est un
//     détail, une page cassée ne l'est pas.
//
// Ces événements servent aussi à décider QUI relancer le lendemain. C'est
// volontaire : seul « answer_1 » et ses suivants prouvent une présence humaine.
// Le clic sur le lien du mail, lui, ne prouve rien — les Safe Links de Microsoft
// ouvrent les liens à la place du destinataire, avant même qu'il n'ait lu.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolvePvInvite } from '@/lib/pv/invites';
import { pvHeaders, pvOptions } from '../_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const OPTIONS = pvOptions;

/** Liste fermée : rien d'autre n'est enregistré. */
const EVENEMENTS = new Set([
  'page_view',
  'answer_1',
  'answer_2',
  'answer_3',
  'email_edit',
  'slot_select',
  'booking_ok',
  'booking_err',
  'callback_open',
  'callback_ok',
]);

export async function POST(req: NextRequest) {
  // 204 quoi qu'il arrive : sendBeacon n'écoute pas la réponse, et un échec de
  // mesure ne doit jamais se voir côté visiteur.
  const fin = () => new NextResponse(null, { status: 204, headers: pvHeaders() });

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const event = typeof body.event === 'string' ? body.event : '';
    if (!EVENEMENTS.has(event)) return fin();

    const lookup = await resolvePvInvite(body.token);
    if (!lookup.ok) return fin();

    const step = Number(body.step);
    const ts = Number(body.ts);
    // L'horodatage vient du navigateur : une horloge déréglée ne doit pas
    // écrire une date aberrante en base.
    const occurredAt =
      Number.isFinite(ts) && Math.abs(Date.now() - ts) < 24 * 3600 * 1000 ? new Date(ts) : new Date();

    await prisma.pvEvent.create({
      data: {
        inviteId: lookup.invite.id,
        event,
        step: Number.isFinite(step) && step >= 0 && step <= 10 ? step : 0,
        occurredAt,
      },
    });
    return fin();
  } catch (err) {
    console.error('[POST /api/pv/events]', err);
    return fin();
  }
}
