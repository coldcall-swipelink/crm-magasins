// POST /api/pv/bookings
//
// La réservation elle-même. Corps = buildPayload() de la page.
//
// Réponses :
//   200 {ok, start, meetUrl} — c'est réservé ;
//   409                      — le créneau vient d'être pris (la page recharge
//                              la liste et invite à en choisir un autre) ;
//   400                      — corps incomplet ou créneau hors grille ;
//   403                      — jeton inconnu, expiré ou révoqué.
//
// Le mail de confirmation (avec le .ics et le lien « déplacer ») part APRÈS la
// réponse : le directeur voit son écran de confirmation sans attendre un
// serveur SMTP.

import { NextRequest } from 'next/server';
import { rejectionMessage, resolvePvInvite } from '@/lib/pv/invites';
import { bookPvDemo, parseBookingPayload, sendBookingConfirmation } from '@/lib/pv/bookings';
import { pvDurationMin } from '@/lib/pv/config';
import { pvForbidden, pvJson, pvOptions } from '../_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const OPTIONS = pvOptions;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return pvJson({ error: 'Corps de requête illisible' }, 400);
  }

  const token = (body as { token?: unknown })?.token;
  const lookup = await resolvePvInvite(token);
  if (!lookup.ok) return pvForbidden(rejectionMessage(lookup.reason));

  const payload = parseBookingPayload(body);
  if ('error' in payload) return pvJson({ error: payload.error }, 400);

  try {
    const outcome = await bookPvDemo(lookup.invite, payload, token as string);

    if (outcome.status === 'conflict') {
      return pvJson({ error: "Ce créneau vient d'être pris." }, 409);
    }
    if (outcome.status === 'invalid') {
      return pvJson({ error: outcome.message }, 400);
    }

    // Confirmation + invitation .ics. Une erreur d'envoi ne remet pas en cause
    // la réservation : elle est acquise, et l'agenda Google a déjà prévenu de
    // son côté.
    const start = new Date(outcome.start);
    const end = new Date(start.getTime() + pvDurationMin() * 60000);
    sendBookingConfirmation(
      lookup.invite,
      token as string,
      start,
      end,
      outcome.meetUrl,
      // Un déplacement remplace l'entrée d'agenda au lieu d'en créer une
      // seconde : la messagerie a besoin d'un numéro de version qui monte.
      lookup.invite.booking ? 1 : 0,
    ).catch(err => console.error('[POST /api/pv/bookings] confirmation :', err));

    return pvJson({ ok: true, start: outcome.start, meetUrl: outcome.meetUrl });
  } catch (err) {
    console.error('[POST /api/pv/bookings]', err);
    return pvJson({ error: 'La réservation n’a pas pu aboutir.' }, 500);
  }
}
