import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Enregistre dans la timeline d'une affaire un email qui a déjà été envoyé
// ailleurs (ex. automatisation N8N qui envoie directement via Resend).
// Contrairement à POST /api/emails, cette route NE renvoie PAS l'email :
// elle crée seulement la ligne EmailLog, pour éviter tout double envoi.
//
// Authentification facultative : si N8N_WEBHOOK_SECRET est défini, l'appel
// doit fournir le même secret dans l'en-tête « Authorization: Bearer <secret> »
// (ou « x-webhook-secret »). Sinon la route reste ouverte (comme /api/emails).
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (secret) {
      const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
      const headerSecret = auth || req.headers.get('x-webhook-secret');
      if (headerSecret !== secret) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
      }
    }

    const { dealId, templateId, to, subject, body, status, resendId, sentAt } =
      await req.json();

    if (!dealId || !to || !subject || !body) {
      return NextResponse.json(
        { error: 'dealId, to, subject et body requis' },
        { status: 400 },
      );
    }

    // Vérifie que l'affaire existe : sinon la contrainte de clé étrangère
    // remonterait une erreur 500 peu parlante.
    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { id: true },
    });
    if (!deal) {
      return NextResponse.json({ error: 'Affaire introuvable' }, { status: 404 });
    }

    const log = await prisma.emailLog.create({
      data: {
        id: `email-${Date.now()}`,
        dealId,
        templateId: templateId || null,
        to,
        subject,
        body,
        status: status || 'sent',
        resendId: resendId || null,
        ...(sentAt ? { sentAt: new Date(sentAt) } : {}),
      },
    });

    return NextResponse.json(log, { status: 201 });
  } catch (err) {
    console.error('[POST /api/emails/log]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
