// src/app/api/campaigns/[id]/preview/route.ts
//
//   POST /api/campaigns/<id>/preview  { stepId, variantId?, leadId? }
//
// Rend une étape telle qu'elle partira : variables remplacées par les valeurs
// d'un vrai lead (le premier inscrit, à défaut n'importe lequel), signature de
// la boîte comprise.
//
// `missing` liste les variables qui n'ont pas trouvé de valeur : c'est le
// garde-fou contre le « Bonjour , » envoyé à trois cents personnes.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildEmail, leadVariables, STANDARD_VARIABLES } from '@/lib/campaigns/render';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const stepId = String(body?.stepId || '');

  const step = await prisma.campaignStep.findFirst({
    where: { id: stepId, campaignId: params.id },
    include: { variants: { orderBy: { key: 'asc' } } },
  });
  if (!step) return NextResponse.json({ error: 'Étape introuvable' }, { status: 404 });

  // En test A/B, l'aperçu porte sur UNE variante : celle demandée, à défaut
  // la première. Hors test, sur le contenu de l'étape.
  let content: { subject: string; bodyText: string; bodyHtml: string; useHtml: boolean } = step;
  if (step.variants.length > 0) {
    const wanted = body?.variantId ? String(body.variantId) : '';
    const variant = step.variants.find(item => item.id === wanted) ?? step.variants[0];
    content = variant;
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: params.id },
    include: { mailboxes: { include: { mailbox: true }, take: 1 } },
  });
  const mailbox = campaign?.mailboxes[0]?.mailbox ?? null;

  // Lead témoin : celui demandé, sinon un inscrit de la campagne, sinon le
  // dernier lead importé. Un aperçu sur des données réelles vaut mieux qu'un
  // aperçu sur « {{prenom}} ».
  const lead = body?.leadId
    ? await prisma.lead.findUnique({ where: { id: String(body.leadId) } })
    : (await prisma.campaignEnrollment.findFirst({
        where: { campaignId: params.id }, include: { lead: true }, orderBy: { createdAt: 'asc' },
      }))?.lead ?? await prisma.lead.findFirst({ orderBy: { createdAt: 'desc' } });

  if (!lead) {
    return NextResponse.json({
      error: "Aucun lead en base : importez au moins un contact pour voir l'aperçu.",
    }, { status: 422 });
  }

  const variables = leadVariables(lead, mailbox ?? undefined);
  const email = buildEmail({
    subjectTemplate: content.subject,
    bodyTemplate: content.useHtml ? content.bodyHtml : content.bodyText,
    useHtml: content.useHtml,
    variables,
    signatureHtml: mailbox?.signatureHtml,
    // Ni pixel ni lien de désinscription dans un aperçu : ils fausseraient les
    // statistiques et pointeraient sur un message qui n'existe pas.
    trackingId: null,
    unsubscribeToken: null,
  });

  return NextResponse.json({
    preview: {
      subject: email.subject,
      html: email.html,
      missing: email.missing,
      lead: { id: lead.id, email: lead.email },
      from: mailbox ? `${mailbox.displayName || ''} <${mailbox.email}>`.trim() : null,
    },
    variables: {
      standard: STANDARD_VARIABLES,
      custom: Object.keys((lead.customFields as Record<string, string>) || {}),
    },
  });
}
