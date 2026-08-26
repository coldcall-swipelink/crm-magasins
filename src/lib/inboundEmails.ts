// src/lib/inboundEmails.ts
//
// Enregistrement des RÉPONSES reçues dans la frise des affaires, quelle que
// soit leur provenance :
//   - relevé IMAP des boîtes @swipelink.fr (src/lib/emailInbox.ts) — la source
//     principale : elle voit tout ce qui arrive dans la boîte, y compris les
//     mails qui ne passent pas par le Reply-To du CRM ;
//   - webhook Resend Inbound (/api/webhooks/resend), si un domaine de réception
//     est configuré.
//
// Les deux passent par recordInboundEmail() : même rattachement, même
// déduplication, même mise à jour du miroir Deal.lastEmailReplyAt.

import { prisma } from '@/lib/prisma';
import { dealIdFromRecipients, extractAddress } from '@/lib/emailReplies';

/** Une réponse reçue, normalisée depuis IMAP ou depuis Resend. */
export interface InboundEmail {
  /** Adresse de l'expéditeur (le contact qui répond). */
  from: string;
  /** Destinataires visibles, pour l'affichage et la détection d'adresse taguée. */
  to: string[];
  cc?: string[];
  /** Adresse réellement servie (Resend `received_for`), si connue. */
  receivedFor?: string[];
  subject: string;
  /** Corps HTML (ou texte) déjà prêt à afficher. */
  body: string;
  /** Date de réception. */
  receivedAt: Date;
  /** Message-ID RFC 5322 de la réponse — clé de déduplication principale. */
  messageId?: string | null;
  /** Message-ID du message auquel elle répond. */
  inReplyTo?: string | null;
  /** Chaîne complète `References`, pour retrouver l'envoi d'origine. */
  references?: string[];
  /** Id Resend, quand la réponse vient du webhook. */
  resendId?: string | null;
}

/** Résultat d'un enregistrement, pour le compte-rendu du relevé. */
export type RecordOutcome = 'created' | 'duplicate' | 'unmatched';

/**
 * Message-ID sous une forme comparable. Selon la source (webhook Resend,
 * en-tête brut, mailparser), le même identifiant arrive avec ou sans chevrons
 * et avec des espaces parasites : sans cette normalisation, une réponse vue à
 * la fois par IMAP et par le webhook serait journalisée deux fois, et le
 * rattachement par fil de discussion échouerait.
 */
export function normalizeMessageId(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^<|>$/g, '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Idem pour une liste (References), en écartant les entrées vides. */
function normalizeMessageIds(values?: (string | null | undefined)[]): string[] {
  return (values ?? [])
    .flatMap(v => (typeof v === 'string' ? v.split(/\s+/) : []))
    .map(normalizeMessageId)
    .filter((v): v is string => v !== null);
}

/**
 * Affaires auxquelles rattacher une réponse, par ordre de fiabilité :
 *   1. l'id encodé dans une adresse de réception « reply+<dealId>@… » ;
 *   2. l'envoi auquel elle répond (In-Reply-To / References → EmailLog.messageId) ;
 *   3. à défaut, l'affaire dont l'email de contact est celui de l'expéditeur.
 * Renvoie une liste vide quand rien ne correspond.
 */
export async function resolveDealsForInbound(email: InboundEmail): Promise<string[]> {
  // 1. Adresse taguée (Resend Inbound).
  const taggedId = dealIdFromRecipients(email.receivedFor, email.to, email.cc);
  if (taggedId) {
    const deal = await prisma.deal.findUnique({ where: { id: taggedId }, select: { id: true } });
    if (deal) return [deal.id];
  }

  // 2. Fil de discussion : on retrouve l'email du CRM auquel il est répondu.
  const threadIds = normalizeMessageIds([email.inReplyTo, ...(email.references ?? [])]);
  if (threadIds.length > 0) {
    const origin = await prisma.emailLog.findFirst({
      where: { messageId: { in: threadIds }, direction: 'outbound' },
      select: { dealId: true },
      orderBy: { sentAt: 'desc' },
    });
    if (origin) return [origin.dealId];
  }

  // 3. Repli : l'adresse de l'expéditeur est l'email de contact d'une affaire.
  const from = extractAddress(email.from);
  if (!from) return [];
  const deals = await prisma.deal.findMany({
    where: { dealEmail: { equals: from, mode: 'insensitive' } },
    select: { id: true },
  });
  return deals.map(d => d.id);
}

/** Identifiant d'un EmailLog créé hors du composeur (l'id est un simple TEXT). */
function newLogId(): string {
  return `email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Journalise une réponse dans la ou les affaires concernées et met à jour le
 * miroir Deal.lastEmailReplyAt (pastille « A répondu » du pipeline).
 *
 * Déduplication : par Message-ID quand il est connu (une même réponse relevée
 * deux fois, ou vue à la fois par IMAP et par le webhook, n'est journalisée
 * qu'une seule fois), à défaut par id Resend.
 */
export async function recordInboundEmail(email: InboundEmail): Promise<RecordOutcome> {
  const dealIds = await resolveDealsForInbound(email);
  if (dealIds.length === 0) return 'unmatched';

  const from = extractAddress(email.from);
  const to = email.to.map(extractAddress).filter(Boolean).join(', ');
  const cc = (email.cc ?? []).map(extractAddress).filter(Boolean);
  // Stockés normalisés : c'est sous cette forme qu'ils sont comparés, ici comme
  // dans resolveDealsForInbound().
  const messageId = normalizeMessageId(email.messageId);
  const inReplyTo = normalizeMessageId(email.inReplyTo);

  let created = false;
  for (const dealId of dealIds) {
    // Une réponse déjà connue pour cette affaire ? On compare sur le Message-ID
    // (stable d'une source à l'autre) puis, à défaut, sur l'id Resend.
    const identity = messageId
      ? { messageId }
      : email.resendId
      ? { resendId: email.resendId }
      : null;
    if (identity) {
      const existing = await prisma.emailLog.findFirst({
        where: { ...identity, dealId },
        select: { id: true },
      });
      if (existing) continue;
    }

    await prisma.emailLog.create({
      data: {
        id: newLogId(),
        dealId,
        direction: 'inbound',
        fromAddress: from || null,
        to,
        cc: cc.length > 0 ? cc.join(', ') : null,
        subject: email.subject || '(sans objet)',
        body: email.body,
        status: 'received',
        resendId: email.resendId || null,
        messageId,
        inReplyTo,
        sentAt: email.receivedAt,
      },
    });
    created = true;

    // Miroir dénormalisé : on ne recule jamais la date (un relevé rejoué ou une
    // réponse arrivée dans le désordre ne doit pas écraser la plus récente).
    await prisma.deal.updateMany({
      where: {
        id: dealId,
        OR: [{ lastEmailReplyAt: null }, { lastEmailReplyAt: { lt: email.receivedAt } }],
      },
      data: { lastEmailReplyAt: email.receivedAt },
    });
  }

  return created ? 'created' : 'duplicate';
}
