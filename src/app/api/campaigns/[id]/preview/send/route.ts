// src/app/api/campaigns/[id]/preview/send/route.ts
//
//   POST /api/campaigns/<id>/preview/send  { stepId, variantId?, leadId?, to }
//
// Envoie l'aperçu d'une étape à l'adresse de son choix, par la boîte de la
// campagne : c'est le seul moyen de voir le mail dans une vraie boîte de
// réception — rendu du client mail, signature, images, filtres.
//
// Un test n'est pas un envoi : aucune ligne dans l'historique, rien de compté
// dans les statistiques ni les quotas, aucun jeton créé. Le sujet est préfixé
// « [TEST] » pour qu'on ne le confonde pas avec un vrai départ.

import { NextRequest, NextResponse } from 'next/server';
import { renderStepPreview } from '@/lib/campaigns/previewEmail';
import { createTransport, fromHeader, readableError } from '@/lib/campaigns/mailboxes';
import { isValidEmail, normalizeEmail } from '@/lib/campaigns/leadFields';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const to = normalizeEmail(String(body?.to || ''));
  if (!isValidEmail(to)) return NextResponse.json({ error: 'Adresse de destination invalide' }, { status: 400 });

  const result = await renderStepPreview(params.id, {
    stepId: String(body?.stepId || ''),
    variantId: body?.variantId ? String(body.variantId) : undefined,
    leadId: body?.leadId ? String(body.leadId) : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const { mailbox } = result;
  if (!mailbox) {
    return NextResponse.json({
      error: "Aucune boîte d'envoi affectée à la campagne : choisissez-en une dans l'onglet Réglages.",
    }, { status: 422 });
  }
  if (!result.subject.trim()) {
    return NextResponse.json({ error: 'Le sujet est vide : rien à envoyer.' }, { status: 422 });
  }

  const subject = `[TEST] ${result.subject}`;
  let transport: ReturnType<typeof createTransport>;
  try {
    // attachDataUrls, comme le moteur : le logo du modèle boucher part en
    // image intégrée, pas en data: URI qu'Outlook n'affiche pas.
    transport = createTransport(mailbox, { attachDataUrls: true });
  } catch (err) {
    return NextResponse.json({ error: `Boîte inutilisable : ${readableError(err)}` }, { status: 422 });
  }

  try {
    const info = await transport.sendMail({
      from: fromHeader(mailbox),
      to,
      subject,
      text: result.text,
      html: result.html,
    });
    return NextResponse.json({
      sent: true,
      to,
      from: mailbox.email,
      subject,
      messageId: info.messageId || null,
    });
  } catch (err) {
    return NextResponse.json({ error: `Envoi refusé : ${readableError(err)}` }, { status: 502 });
  } finally {
    transport.close();
  }
}
