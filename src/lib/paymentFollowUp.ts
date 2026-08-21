// src/lib/paymentFollowUp.ts
//
// Relance des affaires laissées dans « LIEN PAIEMENT ENVOYÉ ».
//
// Principe : à chaque entrée d'une affaire dans cette colonne, on programme une
// relance (table PaymentFollowUp) à l'échéance « entrée + délai » (7 jours par
// défaut, réglable dans les Paramètres). À l'échéance, si l'affaire N'A PAS
// BOUGÉ — comprendre : elle est toujours dans la même colonne — la relance
// devient « à valider ».
//
// RIEN NE PART TOUT SEUL : la relance échue s'affiche dans la pop-up du matin
// de Hugo Abdelhadi et Bilal Yacouti, et le mail n'est envoyé qu'après un clic
// sur « Relancer ». Les deux voient la même file : dès que l'un tranche, la
// décision (et son auteur) est visible chez l'autre.
import { prisma } from '@/lib/prisma';
import { PAYMENT_FOLLOWUP_KEYS } from '@/lib/appSettings';
import { DEFAULT_EMAIL_SENDER, EMAIL_SENDERS, resolveSender } from '@/lib/emailSenders';

/** Normalise un libellé pour comparer sans casse, sans accents ni ponctuation. */
function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Libellés reconnus comme l'étape « lien de paiement envoyé ». Comparaison sur
 * le libellé COMPLET (normalisé) et non sur un « contient » : une colonne
 * « LIEN PAIEMENT À ENVOYER » ne doit surtout pas programmer de relance.
 */
const PAYMENT_LINK_SENT_TITLES = [
  'lien paiement envoye',
  'lien de paiement envoye',
];

/** Vrai si la colonne est « LIEN PAIEMENT ENVOYÉ » (casse et accents ignorés). */
export function isPaymentLinkSentColumn(title?: string | null): boolean {
  return PAYMENT_LINK_SENT_TITLES.includes(normalize(title));
}

/**
 * Les seuls comptes à qui la pop-up de validation s'affiche. Comparaison sur le
 * nom normalisé (le CRM identifie ses utilisateurs par leur nom, cf. User.name).
 */
export const PAYMENT_FOLLOWUP_REVIEWERS = ['Hugo Abdelhadi', 'Bilal Yacouti'];

const REVIEWER_KEYS = PAYMENT_FOLLOWUP_REVIEWERS.map(normalize);

/** Vrai si ce nom d'utilisateur a le droit de voir et de valider les relances. */
export function isFollowUpReviewer(name?: string | null): boolean {
  return REVIEWER_KEYS.includes(normalize(name));
}

/** Délai par défaut entre l'entrée dans la colonne et la relance (jours). */
export const DEFAULT_FOLLOWUP_DELAY_DAYS = 7;

export const DEFAULT_FOLLOWUP_SUBJECT =
  'Votre lien de paiement Swipelink — {{enseigne}} {{nom_magasin}}';

export const DEFAULT_FOLLOWUP_BODY = [
  'Bonjour {{civilite}} {{nom_famille}},',
  '',
  'Je reviens vers vous au sujet du lien de paiement que je vous ai transmis la semaine dernière pour {{enseigne}} {{nom_magasin}}.',
  '',
  'Avez-vous eu l’occasion de finaliser la souscription ? Si vous avez la moindre question, ou si vous souhaitez que nous reprenions ensemble les modalités, je reste à votre disposition.',
  '',
  'Bien à vous,',
].join('\n');

export interface PaymentFollowUpSettings {
  subject: string;
  body: string;
  /** Adresse de l'expéditeur (parmi EMAIL_SENDERS). */
  from: string;
  delayDays: number;
}

/**
 * Réglages du mail de relance (Paramètres › Relance « lien de paiement »).
 * Tolérant : une table AppSetting absente ou une valeur vide retombe sur les
 * valeurs par défaut ci-dessus, pour que la fonctionnalité reste utilisable.
 */
export async function getPaymentFollowUpSettings(): Promise<PaymentFollowUpSettings> {
  const defaults: PaymentFollowUpSettings = {
    subject:   DEFAULT_FOLLOWUP_SUBJECT,
    body:      DEFAULT_FOLLOWUP_BODY,
    from:      DEFAULT_EMAIL_SENDER.email,
    delayDays: DEFAULT_FOLLOWUP_DELAY_DAYS,
  };
  try {
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: Object.values(PAYMENT_FOLLOWUP_KEYS) } },
    });
    const map = new Map(rows.map(r => [r.key, r.value]));
    const rawDelay = Number(map.get(PAYMENT_FOLLOWUP_KEYS.delayDays));
    const from = map.get(PAYMENT_FOLLOWUP_KEYS.from) || '';
    return {
      subject:   map.get(PAYMENT_FOLLOWUP_KEYS.subject)?.trim() || defaults.subject,
      body:      map.get(PAYMENT_FOLLOWUP_KEYS.body)?.trim()    || defaults.body,
      // Un expéditeur retiré de la liste ne doit pas bloquer l'envoi : repli.
      from:      resolveSender(from) ? from : defaults.from,
      delayDays: Number.isFinite(rawDelay) && rawDelay > 0 ? Math.round(rawDelay) : defaults.delayDays,
    };
  } catch {
    return defaults;
  }
}

/** Enregistre les réglages fournis (les champs absents ne sont pas touchés). */
export async function savePaymentFollowUpSettings(patch: Partial<PaymentFollowUpSettings>): Promise<void> {
  const entries: [string, string][] = [];
  if (typeof patch.subject === 'string')  entries.push([PAYMENT_FOLLOWUP_KEYS.subject, patch.subject]);
  if (typeof patch.body === 'string')     entries.push([PAYMENT_FOLLOWUP_KEYS.body, patch.body]);
  if (typeof patch.from === 'string')     entries.push([PAYMENT_FOLLOWUP_KEYS.from, patch.from]);
  if (typeof patch.delayDays === 'number' && Number.isFinite(patch.delayDays)) {
    entries.push([PAYMENT_FOLLOWUP_KEYS.delayDays, String(Math.max(1, Math.round(patch.delayDays)))]);
  }
  for (const [key, value] of entries) {
    await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}

/* ─── Programmation / annulation ──────────────────────────────────────────── */

/** Ajoute `days` jours à une date. */
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Met la file de relances à jour après un changement d'étape.
 *
 *   - Entrée dans « LIEN PAIEMENT ENVOYÉ » → une relance est programmée à
 *     J+délai. Une éventuelle relance encore en attente sur cette affaire est
 *     annulée d'abord : on ne suit que la dernière entrée dans la colonne.
 *   - Sortie de la colonne → l'affaire a bougé, la relance en attente est
 *     annulée (plus rien à relancer).
 *
 * Best-effort, comme la journalisation des déplacements : une erreur ici ne
 * doit JAMAIS faire échouer le déplacement de l'affaire.
 */
export async function syncPaymentFollowUpOnMove(
  dealId: string,
  columnId: string,
  fromColumnId?: string | null,
): Promise<void> {
  try {
    // Pas de changement d'étape (simple repositionnement, ré-enregistrement de
    // la fiche…) : surtout ne pas remettre le compteur des 7 jours à zéro.
    if (fromColumnId && fromColumnId === columnId) return;

    const column = await prisma.pipelineColumn.findUnique({
      where: { id: columnId },
      select: { id: true, title: true },
    });
    if (!column) return;

    // Toute relance encore en attente porte sur une entrée antérieure : que
    // l'affaire quitte la colonne ou y rentre à nouveau, celle-là est caduque.
    await prisma.paymentFollowUp.updateMany({
      where: { dealId, status: 'pending' },
      data: { status: 'cancelled' },
    });

    if (!isPaymentLinkSentColumn(column.title)) return;

    const { delayDays } = await getPaymentFollowUpSettings();
    const enteredAt = new Date();
    await prisma.paymentFollowUp.create({
      data: {
        dealId,
        columnId: column.id,
        columnTitle: column.title,
        enteredAt,
        dueAt: addDays(enteredAt, delayDays),
        status: 'pending',
      },
    });
  } catch (err) {
    console.error('[syncPaymentFollowUpOnMove]', err);
  }
}

/* ─── Rendu du mail ───────────────────────────────────────────────────────── */

type DealForFollowUp = {
  id: string;
  dealEmail: string;
  contactCivilite: string;
  contactLastName: string;
  contactCalling: string;
  directeur: string;
  store: {
    name: string;
    city: string;
    email: string;
    brand: { name: string } | null;
  };
  jobOffers?: { jobTitle: string }[];
};

/** Remplace les variables « {{clef}} » d'un texte (mêmes clés que les templates). */
export function replaceVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

/** Variables disponibles dans le mail de relance (sous-ensemble des templates). */
export const FOLLOWUP_VARIABLES = [
  '{{civilite}}', '{{nom_famille}}', '{{enseigne}}', '{{nom_magasin}}',
  '{{ville}}', '{{directeur}}', '{{contact_calling}}', '{{poste}}',
  '{{prenom_expediteur}}',
];

/** Valeurs des variables pour une affaire donnée. */
export function followUpVars(deal: DealForFollowUp, senderEmail: string): Record<string, string> {
  const sender = EMAIL_SENDERS.find(s => s.email === senderEmail);
  return {
    civilite:          deal.contactCivilite || 'Monsieur',
    nom_famille:       deal.contactLastName || '',
    enseigne:          deal.store.brand?.name || '',
    nom_magasin:       deal.store.name || '',
    ville:             deal.store.city || '',
    directeur:         deal.directeur || '',
    contact_calling:   deal.contactCalling || '',
    poste:             deal.jobOffers?.[0]?.jobTitle || '',
    prenom_expediteur: sender?.label || '',
  };
}

/** Destinataire de la relance : l'email de l'affaire, à défaut celui du magasin. */
export function followUpRecipient(deal: DealForFollowUp): string {
  return (deal.dealEmail || deal.store.email || '').trim();
}

/** Sujet et corps du mail, variables remplacées. */
export function renderFollowUpEmail(deal: DealForFollowUp, settings: PaymentFollowUpSettings) {
  const vars = followUpVars(deal, settings.from);
  return {
    subject: replaceVars(settings.subject, vars),
    body:    replaceVars(settings.body, vars),
  };
}

/* ─── Lecture de la file ──────────────────────────────────────────────────── */

/** Ce que la pop-up affiche pour une relance. */
export interface FollowUpItem {
  id: string;
  dealId: string;
  storeName: string;
  brandName: string;
  city: string;
  contactName: string;
  enteredAt: string;
  dueAt: string;
  status: string;
  /** Destinataire retenu ('' si l'affaire n'a aucune adresse email). */
  to: string;
  subject: string;
  body: string;
  decidedByName: string;
  decidedAt: string | null;
  errorMessage: string;
}

const FOLLOWUP_INCLUDE = {
  deal: {
    select: {
      id: true, columnId: true, dealEmail: true, contactCivilite: true,
      contactLastName: true, contactCalling: true, directeur: true,
      store: { select: { name: true, city: true, email: true, brand: { select: { name: true } } } },
      jobOffers: { select: { jobTitle: true }, orderBy: { firstSeenAt: 'desc' as const }, take: 1 },
    },
  },
} as const;

/** Une ligne PaymentFollowUp lue avec FOLLOWUP_INCLUDE. */
interface FollowUpRow {
  id: string;
  dealId: string;
  columnId: string;
  enteredAt: Date;
  dueAt: Date;
  status: string;
  decidedByName: string;
  decidedAt: Date | null;
  errorMessage: string;
  deal: DealForFollowUp & { columnId: string };
}

function toItem(row: FollowUpRow, settings: PaymentFollowUpSettings): FollowUpItem {
  const deal = row.deal;
  const rendered = renderFollowUpEmail(deal, settings);
  return {
    id: row.id,
    dealId: row.dealId,
    storeName: deal.store.name,
    brandName: deal.store.brand?.name || '',
    city: deal.store.city || '',
    contactName: [deal.contactCivilite, deal.contactLastName].filter(Boolean).join(' ').trim(),
    enteredAt: row.enteredAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    status: row.status,
    to: followUpRecipient(deal),
    subject: rendered.subject,
    body: rendered.body,
    decidedByName: row.decidedByName,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    errorMessage: row.errorMessage,
  };
}

/** Fenêtre pendant laquelle une relance déjà tranchée reste affichée (heures). */
const DECIDED_WINDOW_HOURS = 36;

/**
 * File de la pop-up du matin :
 *   - `pending` : relances échues dont l'affaire n'a pas bougé — à valider
 *     (y compris celles dont un envoi a échoué : elles sont à rejouer) ;
 *   - `decided` : relances tranchées récemment (par soi OU par l'autre), pour
 *     que chacun voie ce que l'autre a déjà fait.
 *
 * Les relances dont l'affaire a changé de colonne depuis sont annulées au
 * passage : le déplacement les annule déjà, ce filet ne sert qu'aux
 * déplacements qui auraient échappé au journal (import, écriture directe).
 */
export async function listPaymentFollowUps(): Promise<{ pending: FollowUpItem[]; decided: FollowUpItem[] }> {
  const settings = await getPaymentFollowUpSettings();
  const now = new Date();

  const due = await prisma.paymentFollowUp.findMany({
    // « error » : une relance validée dont l'envoi a échoué reste à traiter —
    // elle revient dans la file, avec son motif, pour être rejouée.
    where: { status: { in: ['pending', 'error'] }, dueAt: { lte: now } },
    include: FOLLOWUP_INCLUDE,
    orderBy: { dueAt: 'asc' },
  });

  // L'affaire a bougé → il n'y a plus de relance à faire.
  const moved = due.filter(r => r.deal.columnId !== r.columnId);
  if (moved.length) {
    await prisma.paymentFollowUp.updateMany({
      where: { id: { in: moved.map(r => r.id) } },
      data: { status: 'cancelled' },
    });
  }
  const movedIds = new Set(moved.map(r => r.id));

  const decided = await prisma.paymentFollowUp.findMany({
    where: {
      // « sending » : réservée par un relecteur, envoi en cours (ou interrompu) —
      // elle doit rester visible pour que l'autre ne la relance pas en double.
      // « error » n'est PAS ici : elle reste dans la file à traiter (ci-dessus).
      status: { in: ['sent', 'skipped', 'sending'] },
      decidedAt: { gte: new Date(now.getTime() - DECIDED_WINDOW_HOURS * 3600_000) },
    },
    include: FOLLOWUP_INCLUDE,
    orderBy: { decidedAt: 'desc' },
  });

  return {
    pending: due.filter(r => !movedIds.has(r.id)).map(r => toItem(r, settings)),
    decided: decided.map(r => toItem(r, settings)),
  };
}
