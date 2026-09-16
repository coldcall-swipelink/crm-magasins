// POST /api/pv/callbacks
//
// « Aucun créneau ne vous convient ? Être rappelé ».
//
// Un directeur qui laisse son numéro est un directeur intéressé : l'affaire est
// marquée « À rappeler », son numéro et ses réponses sont enregistrés, et une
// action datée du jour est créée pour que personne ne l'oublie.

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { rejectionMessage, resolvePvInvite } from '@/lib/pv/invites';
import { toE164 } from '@/lib/pv/sms';
import { pvForbidden, pvJson, pvOptions } from '../_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const OPTIONS = pvOptions;

/** Colonnes candidates pour « à rappeler », de la plus précise à la plus large. */
const COLONNES_RAPPEL = ['À RAPPELER', 'À rappeler', 'A RAPPELER', 'À appeler'];

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return pvJson({ error: 'Corps de requête illisible' }, 400);
  }

  const lookup = await resolvePvInvite(body.token);
  if (!lookup.ok) return pvForbidden(rejectionMessage(lookup.reason));

  const telephone = typeof body.telephone === 'string' ? body.telephone.trim() : '';
  if (!toE164(telephone)) return pvJson({ error: 'Numéro de téléphone invalide' }, 400);

  const texte = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const experience = texte(body.experience);
  const salaire = texte(body.salaire);
  const priseDePoste = texte(body.priseDePoste);

  try {
    const { invite } = lookup;

    // Colonne « à rappeler » du pipeline de l'affaire. Introuvable → l'affaire
    // ne bouge pas, mais la note et l'action, elles, sont bien écrites.
    const colonne = await prisma.pipelineColumn.findFirst({
      where: { pipelineId: invite.deal.pipelineId, title: { in: COLONNES_RAPPEL } },
      select: { id: true },
    });

    await prisma.$transaction(async tx => {
      await tx.pvInvite.update({
        where: { id: invite.id },
        data: {
          callbackPhone: telephone,
          callbackAt: new Date(),
          experience: experience || invite.experience,
          salaire: salaire || invite.salaire,
          priseDePoste: priseDePoste || invite.priseDePoste,
        },
      });

      await tx.deal.update({
        where: { id: invite.dealId },
        data: {
          isPV: true,
          contactPhone: telephone,
          pvExperience: experience || undefined,
          pvSalaire: salaire || undefined,
          pvPriseDePoste: priseDePoste || undefined,
          ...(colonne ? { columnId: colonne.id } : {}),
        },
      });

      await tx.note.create({
        data: {
          dealId: invite.dealId,
          content:
            `Demande de rappel depuis le parcours « 2 CV de bouchers ».\n`
            + `Téléphone : ${telephone}\n`
            + `Expérience : ${experience || '—'} · Salaire : ${salaire || '—'} · `
            + `Prise de poste : ${priseDePoste || '—'}`,
          authorName: 'Swipelink',
        },
      });

      await tx.action.create({
        data: {
          dealId: invite.dealId,
          title: `Rappeler le magasin (parcours boucher) — ${telephone}`,
          type: 'Appeler',
          dueDate: new Date(),
          priority: 'élevée',
          note: `Aucun créneau ne convenait au directeur. Expérience : ${experience || '—'}, `
            + `salaire : ${salaire || '—'}, prise de poste : ${priseDePoste || '—'}.`,
        },
      });
    });

    return pvJson({ ok: true });
  } catch (err) {
    console.error('[POST /api/pv/callbacks]', err);
    return pvJson({ error: 'La demande n’a pas pu aboutir.' }, 500);
  }
}
