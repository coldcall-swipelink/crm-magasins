// src/app/api/campaigns/[id]/steps/[stepId]/route.ts
//
//   PATCH  /api/campaigns/<id>/steps/<stepId>  → contenu et délai de l'étape
//   DELETE /api/campaigns/<id>/steps/<stepId>  → supprime l'étape et renumérote
//
// Modifier une étape ne touche pas aux emails déjà partis : ils restent
// archivés tels qu'ils ont été envoyés dans CampaignMessage.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; stepId: string } }) {
  const step = await prisma.campaignStep.findFirst({
    where: { id: params.stepId, campaignId: params.id },
  });
  if (!step) return NextResponse.json({ error: 'Étape introuvable' }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (body.subject !== undefined) data.subject = String(body.subject);
  if (body.bodyText !== undefined) data.bodyText = String(body.bodyText);
  if (body.bodyHtml !== undefined) data.bodyHtml = String(body.bodyHtml);
  if (body.useHtml !== undefined) data.useHtml = Boolean(body.useHtml);
  if (body.replyToThread !== undefined) data.replyToThread = Boolean(body.replyToThread);
  if (body.delayHours !== undefined) {
    const hours = Number(body.delayHours);
    // Borné à 90 jours : au-delà, c'est une erreur de saisie, pas une relance.
    if (Number.isFinite(hours)) data.delayHours = Math.min(2160, Math.max(0, Math.round(hours)));
  }

  const updated = await prisma.campaignStep.update({ where: { id: params.stepId }, data });
  return NextResponse.json({ step: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; stepId: string } }) {
  const step = await prisma.campaignStep.findFirst({
    where: { id: params.stepId, campaignId: params.id },
  });
  if (!step) return NextResponse.json({ error: 'Étape introuvable' }, { status: 404 });

  const count = await prisma.campaignStep.count({ where: { campaignId: params.id } });
  if (count <= 1) {
    return NextResponse.json({ error: 'Une campagne garde au moins une étape.' }, { status: 422 });
  }

  await prisma.campaignStep.delete({ where: { id: params.stepId } });

  // Renumérotation : les positions doivent rester 1, 2, 3… sans trou, car le
  // moteur avance par rang (`sentSteps`) dans la liste ordonnée.
  const rest = await prisma.campaignStep.findMany({
    where: { campaignId: params.id }, orderBy: { position: 'asc' },
  });
  // En deux temps : les positions sont uniques par campagne, une renumérotation
  // directe se heurterait à l'unicité. On décale d'abord hors de portée.
  for (let index = 0; index < rest.length; index++) {
    await prisma.campaignStep.update({ where: { id: rest[index].id }, data: { position: 1000 + index } });
  }
  for (let index = 0; index < rest.length; index++) {
    await prisma.campaignStep.update({ where: { id: rest[index].id }, data: { position: index + 1 } });
  }

  return NextResponse.json({ ok: true });
}
