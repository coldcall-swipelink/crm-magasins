import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Resend } from 'resend';
import { extractAddress, inboundDomain } from '@/lib/emailReplies';
import { normalizeMessageId, recordInboundEmail } from '@/lib/inboundEmails';

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
  // Normalisé : c'est ce Message-ID que les réponses citeront dans leur
  // In-Reply-To, et la comparaison se fait sur la forme sans chevrons.
  const messageId = normalizeMessageId(typeof payload.message_id === 'string' ? payload.message_id : null);

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

// Journalise une réponse reçue via Resend Inbound. Le rattachement à l'affaire,
// la déduplication et la mise à jour de Deal.lastEmailReplyAt sont communs au
// relevé IMAP : tout passe par recordInboundEmail().
async function logReceivedEmail(emailId: string, data: Record<string, unknown>) {
  const full = await fetchReceivedEmail(emailId);

  // Destinataires affichés : la boîte @swipelink.fr visée, pas l'adresse
  // technique reply+<dealId>@… (repli sur cette dernière si elle est la seule).
  const domain = inboundDomain();
  const tos = recipients(data.to).map(extractAddress);
  const visible = tos.filter(t => !t.toLowerCase().endsWith(`@${domain}`));

  const outcome = await recordInboundEmail({
    from: extractAddress(typeof data.from === 'string' ? data.from : ''),
    to: visible.length > 0 ? visible : tos,
    cc: recipients(data.cc).map(extractAddress),
    // `received_for` = adresse réellement servie par Resend : c'est là que se
    // trouve l'adresse taguée quand la réponse est partie en copie cachée.
    receivedFor: recipients(data.received_for),
    subject: full?.subject || (typeof data.subject === 'string' ? data.subject : '') || '',
    body: full?.html || full?.text || '',
    receivedAt: typeof data.created_at === 'string' ? new Date(data.created_at) : new Date(),
    messageId: typeof data.message_id === 'string'
      ? data.message_id
      : header(full?.headers, 'Message-ID'),
    inReplyTo: header(full?.headers, 'In-Reply-To'),
    references: (header(full?.headers, 'References') || '').split(/\s+/).filter(Boolean),
    resendId: emailId,
  });

  if (outcome === 'unmatched') {
    console.warn('[Resend webhook] réponse sans affaire correspondante', { emailId, from: data.from });
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
