// src/lib/emailReplies.ts
//
// Capture des RÉPONSES aux emails du CRM (Resend Inbound).
//
// Principe
// --------
// Les emails du CRM partent d'une vraie boîte @swipelink.fr (hugo@, bilal@…) :
// sans rien faire, les réponses atterrissent dans ces boîtes Gmail et le CRM ne
// les voit jamais. On ajoute donc à chaque envoi un `Reply-To` à DEUX adresses :
//
//   1. reply+<dealId>@<RESEND_INBOUND_DOMAIN>  → boîte de réception Resend, qui
//      déclenche le webhook `email.received` (cf. /api/webhooks/resend). Le
//      « plus-addressing » embarque l'id de l'affaire : le rattachement est
//      déterministe, aucune devinette sur l'adresse de l'expéditeur.
//   2. l'adresse de l'expéditeur (hugo@swipelink.fr…) → la réponse arrive AUSSI
//      dans sa boîte Gmail, comme aujourd'hui. Personne ne perd rien.
//
// Mise en place côté infra (une seule fois) :
//   - un sous-domaine dédié, ex. « inbox.swipelink.fr », avec l'enregistrement
//     MX de Resend (priorité la plus basse) ;
//   - dans Resend → Webhooks, activer l'événement `email.received` sur
//     l'endpoint /api/webhooks/resend déjà utilisé ;
//   - RESEND_INBOUND_DOMAIN="inbox.swipelink.fr" dans l'environnement.
//
// Sans RESEND_INBOUND_DOMAIN, tout ce module se désactive proprement : les
// envois repartent avec le comportement d'avant (Reply-To = expéditeur).

/** Partie locale des adresses de réception : reply+<dealId>@domaine. */
const LOCAL_PART = 'reply';

/** Sous-domaine de réception configuré chez Resend (vide = fonction inactive). */
export function inboundDomain(): string {
  return (process.env.RESEND_INBOUND_DOMAIN || '').trim().toLowerCase();
}

/** Vrai si la capture des réponses est configurée. */
export function isInboundConfigured(): boolean {
  return inboundDomain().length > 0;
}

/**
 * Adresse de réception taguée pour une affaire, ou null si la réception n'est
 * pas configurée (ou l'id d'affaire absent / non représentable dans une adresse).
 */
export function replyAddressForDeal(dealId?: string | null): string | null {
  const domain = inboundDomain();
  if (!domain || !dealId) return null;
  // Les ids d'affaire sont des cuid ([a-z0-9]) ; on refuse tout ce qui ne
  // passerait pas tel quel dans une partie locale d'adresse.
  if (!/^[A-Za-z0-9_-]+$/.test(dealId)) return null;
  return `${LOCAL_PART}+${dealId}@${domain}`;
}

/** Extrait l'adresse d'un « Nom <adresse@x.fr> » (ou la renvoie telle quelle). */
export function extractAddress(value?: string | null): string {
  if (!value) return '';
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim();
}

/**
 * Valeur `reply_to` à passer à Resend pour un envoi : l'adresse taguée du CRM
 * puis celle de l'expéditeur (pour que la réponse arrive aussi dans sa boîte).
 * Retourne undefined quand la réception n'est pas configurée — Resend retombe
 * alors sur son défaut (Reply-To = From), c'est-à-dire le comportement d'avant.
 */
export function buildReplyTo(dealId?: string | null, fromAddress?: string | null): string[] | undefined {
  const tagged = replyAddressForDeal(dealId);
  if (!tagged) return undefined;
  const sender = extractAddress(fromAddress);
  return sender ? [tagged, sender] : [tagged];
}

/**
 * Id d'affaire encodé dans une adresse de réception, ou null si l'adresse n'est
 * pas une adresse taguée de notre domaine de réception.
 */
export function dealIdFromAddress(value?: string | null): string | null {
  const address = extractAddress(value);
  const domain = inboundDomain();
  if (!address || !domain) return null;
  const at = address.lastIndexOf('@');
  if (at < 0) return null;
  // Domaine et partie « reply » comparés sans tenir compte de la casse ; le tag
  // (= l'id d'affaire) est en revanche conservé tel quel.
  if (address.slice(at + 1).toLowerCase() !== domain) return null;
  const local = address.slice(0, at);
  const plus = local.indexOf('+');
  if (plus < 0) return null;
  if (local.slice(0, plus).toLowerCase() !== LOCAL_PART) return null;
  return local.slice(plus + 1) || null;
}

/**
 * Parcourt les destinataires d'un email entrant (To / Cc / Bcc et surtout
 * `received_for`, l'adresse réellement servie par Resend) et renvoie le premier
 * id d'affaire trouvé.
 */
export function dealIdFromRecipients(...lists: unknown[]): string | null {
  for (const list of lists) {
    const values = Array.isArray(list) ? list : typeof list === 'string' ? [list] : [];
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const dealId = dealIdFromAddress(value);
      if (dealId) return dealId;
    }
  }
  return null;
}
