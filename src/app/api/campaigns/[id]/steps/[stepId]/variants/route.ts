// src/app/api/campaigns/[id]/steps/[stepId]/variants/route.ts
//
//   POST /api/campaigns/<id>/steps/<stepId>/variants  → ajoute une variante
//
// Première variante d'une étape = ouverture du test A/B : l'étape n'ayant
// encore aucune variante, on crée d'abord « A » avec son contenu actuel (le
// texte qu'on envoyait jusqu'ici est la référence), puis la nouvelle, vide.
// Le client reçoit ainsi A et B d'un seul appel, et ouvre B pour la rédiger.
//
// Les lettres ne se recyclent pas : on prend la première libre, et une lettre
// supprimée reste libre. C'est ce qui permet aux statistiques de continuer à
// dire « B » pour les emails partis en B, même après sa suppression.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { MAX_VARIANTS, nextVariantKey } from '@/lib/campaigns/variants';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string; stepId: string } }) {
  const step = await prisma.campaignStep.findFirst({
    where: { id: params.stepId, campaignId: params.id },
    include: { variants: { orderBy: { key: 'asc' } } },
  });
  if (!step) return NextResponse.json({ error: 'Étape introuvable' }, { status: 404 });

  if (step.variants.length >= MAX_VARIANTS) {
    return NextResponse.json({ error: `Au plus ${MAX_VARIANTS} variantes par étape.` }, { status: 422 });
  }

  const body = await req.json().catch(() => ({}));
  const created: string[] = [];

  // Ouverture du test : la référence « A » reprend le contenu de l'étape.
  if (step.variants.length === 0) {
    const reference = await prisma.campaignStepVariant.create({
      data: {
        stepId: step.id, key: 'A',
        subject: step.subject, bodyText: step.bodyText, bodyHtml: step.bodyHtml, useHtml: step.useHtml,
      },
    });
    created.push(reference.id);
    step.variants.push(reference);
  }

  const key = nextVariantKey(step.variants);
  if (!key) return NextResponse.json({ error: `Au plus ${MAX_VARIANTS} variantes par étape.` }, { status: 422 });

  // Une nouvelle variante peut partir d'une copie (« dupliquer B pour ne
  // changer que le sujet ») ou d'une page blanche.
  const source = body?.copyFrom ? step.variants.find(variant => variant.id === String(body.copyFrom)) : null;
  const variant = await prisma.campaignStepVariant.create({
    data: {
      stepId: step.id, key,
      subject: source?.subject ?? '',
      bodyText: source?.bodyText ?? '',
      bodyHtml: source?.bodyHtml ?? '',
      useHtml: source?.useHtml ?? step.useHtml,
    },
  });
  created.push(variant.id);

  // Le test est visible dans les statistiques dès qu'il est ouvert ; la
  // lettre gagnante d'un test précédent ne vaut plus.
  if (step.abWinner) {
    await prisma.campaignStep.update({ where: { id: step.id }, data: { abWinner: '' } });
  }

  const variants = await prisma.campaignStepVariant.findMany({ where: { stepId: step.id }, orderBy: { key: 'asc' } });
  return NextResponse.json({ variant, variants, created }, { status: 201 });
}
