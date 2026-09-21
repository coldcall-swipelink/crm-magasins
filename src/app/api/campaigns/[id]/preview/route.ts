// src/app/api/campaigns/[id]/preview/route.ts
//
//   POST /api/campaigns/<id>/preview  { stepId, variantId?, leadId? }
//
// Rend une étape telle qu'elle partira : variables remplacées par les valeurs
// d'un vrai lead (le premier inscrit, à défaut n'importe lequel), signature de
// la boîte comprise. Le rendu lui-même est dans src/lib/campaigns/previewEmail.ts,
// partagé avec l'envoi de test (preview/send).
//
// `missing` liste les variables qui n'ont pas trouvé de valeur : c'est le
// garde-fou contre le « Bonjour , » envoyé à trois cents personnes.

import { NextRequest, NextResponse } from 'next/server';
import { renderStepPreview } from '@/lib/campaigns/previewEmail';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const result = await renderStepPreview(params.id, {
    stepId: String(body?.stepId || ''),
    variantId: body?.variantId ? String(body.variantId) : undefined,
    leadId: body?.leadId ? String(body.leadId) : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const { mailbox } = result;
  return NextResponse.json({
    preview: {
      subject: result.subject,
      html: result.html,
      missing: result.missing,
      lead: { id: result.lead.id, email: result.lead.email },
      from: mailbox ? `${mailbox.displayName || ''} <${mailbox.email}>`.trim() : null,
      // L'envoi de test passe par la boîte de la campagne : sans boîte, pas de test.
      canSend: Boolean(mailbox),
    },
    variables: result.variables,
  });
}
