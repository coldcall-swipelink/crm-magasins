// GET /api/pv/slots?t=<jeton>
//
// Les créneaux réellement libres de l'agenda des démos, à J+2 minimum.
//
// Recalculés à chaque appel, sans aucun cache : la page les recharge toutes les
// 30 secondes, au retour sur l'onglet, après un 409 et après chaque
// réservation. Un créneau pris doit disparaître dans la foulée, sinon deux
// directeurs choisissent le même et le second se fait refuser pour rien.

import { NextRequest } from 'next/server';
import { rejectionMessage, resolvePvInvite } from '@/lib/pv/invites';
import { listFreeSlots } from '@/lib/pv/slots';
import { pvForbidden, pvJson, pvOptions } from '../_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const OPTIONS = pvOptions;

export async function GET(req: NextRequest) {
  const lookup = await resolvePvInvite(req.nextUrl.searchParams.get('t'));
  if (!lookup.ok) return pvForbidden(rejectionMessage(lookup.reason));

  try {
    return pvJson(await listFreeSlots());
  } catch (err) {
    console.error('[GET /api/pv/slots]', err);
    // La page sait afficher « impossible de charger les créneaux » et propose
    // le rappel téléphonique juste en dessous : mieux vaut un échec franc qu'une
    // liste inventée.
    return pvJson({ error: 'Créneaux indisponibles' }, 502);
  }
}
