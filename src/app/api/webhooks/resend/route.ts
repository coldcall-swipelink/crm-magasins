import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Resend } from 'resend';

export const dynamic = 'force-dynamic';

// Normalise le champ destinataire du payload Resend (string ou tableau).
function recipients(to: unknown): string[] {
  if (Array.isArray(to)) return to.filter((x): x is string => typeof x === 'string');
  if (typeof to === 'string') return [to];
  return [];
}

// Enregistre dans la timeline des affaires un email parti par Resend, qu'il
// vienne du CRM ou d'une automatisation externe (ex. N8N). L'affaire est
// retrouvée via son email de contact (Deal.dealEmail == destinataire).
//
// - Rattachement à TOUTES les affaires partageant l'adresse du destinataire.
// - Déduplication par couple (resendId, dealId) : un email déjà journalisé
//   (envoi depuis le CRM via POST /api/emails) n'est pas dupliqué.
async function logSentEmail(emailId: string, payload: Record<string, unknown>) {
  const tos = recipients(payload.to);
  if (tos.length === 0) return;

  // Récupère le contenu complet (le payload du webhook ne contient ni le HTML
  // ni le texte). Best-effort : en cas d'échec on retombe sur les métadonnées.
  let subject = typeof payload.subject === 'string' ? payload.subject : '(sans objet)';
  let body = '';
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data } = await resend.emails.get(emailId);
    if (data) {
      subject = data.subject || subject;
      body = (data.html || data.text || '') as string;
    }
  } catch (e) {
    console.warn('[Resend webhook] récupération du contenu impossible', e);
  }

  for (const to of tos) {
    const deals = await prisma.deal.findMany({
      where: { dealEmail: { equals: to, mode: 'insensitive' } },
      select: { id: true },
    });

    for (const deal of deals) {
      // Déjà journalisé pour cette affaire (ex. envoi depuis le CRM) ?
      const existing = await prisma.emailLog.findFirst({
        where: { resendId: emailId, dealId: deal.id },
        select: { id: true },
      });
      if (existing) continue;

      await prisma.emailLog.create({
        data: {
          id: `email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          dealId: deal.id,
          to,
          subject,
          body,
          status: 'sent',
          resendId: emailId,
        },
      });
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, data } = body;
    const emailId = data?.email_id;

    if (type === 'email.opened') {
      if (emailId) {
        await prisma.emailLog.updateMany({
          where: { resendId: emailId },
          data: { status: 'opened', openedAt: new Date() },
        });
      }
    } else if (type === 'email.sent' || type === 'email.delivered') {
      if (emailId) {
        await logSentEmail(emailId, data as Record<string, unknown>);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Resend webhook]', err);
    return NextResponse.json({ error: 'Erreur' }, { status: 500 });
  }
}
