// src/app/api/campaigns/[id]/steps/[stepId]/variants/[variantId]/route.ts
//
//   PATCH  …/variants/<variantId>  → contenu, mise en pause, ou « garder »
//   DELETE …/variants/<variantId>  → retire la variante du test
//
// « Garder » (`{ promote: true }`) clôt le test : le contenu de la variante
// devient celui de l'étape, toutes les variantes disparaissent, et l'étape
// redevient une étape simple. Les emails déjà partis conservent leur lettre :
// les statistiques du test restent lisibles, avec la lettre retenue.
//
// Supprimer l'avant-dernière variante clôt le test de la même façon, sur
// celle qui reste : une étape à une seule variante n'est pas un test, et
// laisser l'étape dans cet état obligerait à deviner ce qui part.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { CampaignStepVariant } from '@prisma/client';

export const dynamic = 'force-dynamic';

type Params = { params: { id: string; stepId: string; variantId: string } };

async function findVariant(params: Params['params']) {
  return prisma.campaignStepVariant.findFirst({
    where: { id: params.variantId, stepId: params.stepId, step: { campaignId: params.id } },
    include: { step: { include: { variants: { orderBy: { key: 'asc' } } } } },
  });
}

/** Clôt le test sur `winner` : son texte devient celui de l'étape. */
async function promote(stepId: string, winner: CampaignStepVariant) {
  await prisma.$transaction([
    prisma.campaignStep.update({
      where: { id: stepId },
      data: {
        subject: winner.subject, bodyText: winner.bodyText, bodyHtml: winner.bodyHtml, useHtml: winner.useHtml,
        abWinner: winner.key,
      },
    }),
    prisma.campaignStepVariant.deleteMany({ where: { stepId } }),
  ]);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const variant = await findVariant(params);
  if (!variant) return NextResponse.json({ error: 'Variante introuvable' }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });

  if (body.promote) {
    await promote(variant.stepId, variant);
    const step = await prisma.campaignStep.findUnique({ where: { id: variant.stepId }, include: { variants: true } });
    return NextResponse.json({ step, promoted: variant.key });
  }

  const data: Record<string, unknown> = {};
  if (body.subject !== undefined) data.subject = String(body.subject);
  if (body.bodyText !== undefined) data.bodyText = String(body.bodyText);
  if (body.bodyHtml !== undefined) data.bodyHtml = String(body.bodyHtml);
  if (body.useHtml !== undefined) data.useHtml = Boolean(body.useHtml);
  if (body.active !== undefined) {
    const active = Boolean(body.active);
    // Mettre en pause la dernière variante active éteindrait le test sans le
    // dire : les leads attendraient sans qu'aucun texte ne parte.
    if (!active && !variant.step.variants.some(item => item.id !== variant.id && item.active)) {
      return NextResponse.json({ error: 'Gardez au moins une variante active — ou clôturez le test en gardant celle-ci.' }, { status: 422 });
    }
    data.active = active;
  }

  const updated = await prisma.campaignStepVariant.update({ where: { id: variant.id }, data });
  return NextResponse.json({ variant: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const variant = await findVariant(params);
  if (!variant) return NextResponse.json({ error: 'Variante introuvable' }, { status: 404 });

  const others = variant.step.variants.filter(item => item.id !== variant.id);
  if (others.length === 1) {
    // Plus qu'une : le test est fini, elle devient l'étape.
    await promote(variant.stepId, others[0]);
    return NextResponse.json({ ok: true, promoted: others[0].key });
  }

  await prisma.campaignStepVariant.delete({ where: { id: variant.id } });
  return NextResponse.json({ ok: true });
}
