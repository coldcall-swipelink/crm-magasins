import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Resend } from 'resend';
import { dealIdFromRecipients, extractAddress, inboundDomain } from '@/lib/emailReplies';

export const dynamic = 'force-dynamic';

// Normalise le champ destinataire du payload Resend (string ou tableau).
function recipients(to: unknown): string[] {
  if (Array.isArray(to)) return to.filter((x): x is string => typeof x === 'string');
  if (typeof to === 'string') return [to];
  return [];
}

// Identifiant d'un EmailLog créé par le webhook (l'id est un simple TEXT).
function newLogId(): string {
  return `email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  const from = extractAddress(typeof payload.from === 'string' ? payload.from : '');
  const messageId = typeof payload.message_id === 'string' ? payload.message_id : null;

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
          id: newLogId(),
          dealId: deal.id,
          direction: 'outbound',
          fromAddress: from || null,
          to,
          subject,
          body,
          status: 'sent',
          resendId: emailId,
          messageId,
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Réponses reçues (Resend Inbound, événement `email.received`)
// ---------------------------------------------------------------------------

// Contenu complet d'un email entrant. Le payload du webhook ne porte que des
// métadonnées : le corps se lit sur l'API Receiving. Appel en `fetch` direct
// car le SDK installé (resend 3.x) ne l'expose pas encore.
interface ReceivedEmail {
  html?: string | null;
  text?: string | null;
  subject?: string | null;
  headers?: Record<string, string> | null;
}

async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn('[Resend webhook] API Receiving', res.status, await res.text());
      return null;
    }
    return (await res.json()) as ReceivedEmail;
  } catch (e) {
    console.warn('[Resend webhook] récupération de la réponse impossible', e);
    return null;
  }
}

/** Lecture insensible à la casse d'un en-tête RFC 5322. */
function header(headers: Record<string, string> | null | undefined, name: string): string | null {
  if (!headers) return null;
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

/**
 * Affaire à laquelle rattacher une réponse :
 *   1. l'id encodé dans l'adresse de réception (reply+<dealId>@…) — déterministe ;
 *   2. à défaut, l'affaire dont l'email de contact est celui de l'expéditeur.
 * Renvoie la liste des affaires concernées (vide = réponse ignorée).
 */
async function dealsForReply(data: Record<string, unknown>, from: string): Promise<string[]> {
  const taggedId = dealIdFromRecipients(data.received_for, data.to, data.cc, data.bcc);
  if (taggedId) {
    const deal = await prisma.deal.findUnique({ where: { id: taggedId }, select: { id: true } });
    if (deal) return [deal.id];
  }
  if (!from) return [];
  const deals = await prisma.deal.findMany({
    where: { dealEmail: { equals: from, mode: 'insensitive' } },
    select: { id: true },
  });
  return deals.map(d => d.id);
}

// Journalise une réponse reçue dans la ou les affaires concernées et met à jour
// le miroir Deal.lastEmailReplyAt (pastille « A répondu » du pipeline).
async function logReceivedEmail(emailId: string, data: Record<string, unknown>) {
  const from = extractAddress(typeof data.from === 'string' ? data.from : '');
  const dealIds = await dealsForReply(data, from);
  if (dealIds.length === 0) {
    console.warn('[Resend webhook] réponse sans affaire correspondante', { emailId, from });
    return;
  }

  const full = await fetchReceivedEmail(emailId);
  const subject = full?.subject || (typeof data.subject === 'string' ? data.subject : '') || '(sans objet)';
  const body = full?.html || full?.text || '';
  const inReplyTo = header(full?.headers, 'In-Reply-To');
  const messageId = typeof data.message_id === 'string'
    ? data.message_id
    : header(full?.headers, 'Message-ID');

  // Destinataire affiché : la boîte @swipelink.fr visée, pas l'adresse technique
  // reply+<dealId>@… (repli sur cette dernière si elle est la seule).
  const domain = inboundDomain();
  const tos = recipients(data.to);
  const visible = tos.filter(t => !extractAddress(t).toLowerCase().endsWith(`@${domain}`));
  const to = (visible.length > 0 ? visible : tos).map(extractAddress).join(', ');

  const cc = recipients(data.cc).map(extractAddress).filter(Boolean);
  const receivedAt = typeof data.created_at === 'string' ? new Date(data.created_at) : new Date();

  for (const dealId of dealIds) {
    const existing = await prisma.emailLog.findFirst({
      where: { resendId: emailId, dealId },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.emailLog.create({
      data: {
        id: newLogId(),
        dealId,
        direction: 'inbound',
        fromAddress: from || null,
        to,
        cc: cc.length > 0 ? cc.join(', ') : null,
        subject,
        body,
        status: 'received',
        resendId: emailId,
        messageId,
        inReplyTo,
        sentAt: receivedAt,
      },
    });

    // Miroir dénormalisé : on ne recule jamais la date (un webhook rejoué ou
    // une réponse arrivée dans le désordre ne doit pas écraser la plus récente).
    await prisma.deal.updateMany({
      where: {
        id: dealId,
        OR: [{ lastEmailReplyAt: null }, { lastEmailReplyAt: { lt: receivedAt } }],
      },
      data: { lastEmailReplyAt: receivedAt },
    });
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
    } else if (type === 'email.received') {
      if (emailId) {
        await logReceivedEmail(emailId, data as Record<string, unknown>);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Resend webhook]', err);
    return NextResponse.json({ error: 'Erreur' }, { status: 500 });
  }
}
