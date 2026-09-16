// src/lib/campaigns/crmLink.ts
//
// Liaison entre un lead de prospection et l'affaire du CRM dont il vient.
//
// Un lead repris du CRM et son affaire décrivent le MÊME contact. Les laisser
// diverger, c'est se retrouver avec deux vérités : le nom corrigé pendant un
// appel resterait faux dans les emails, et l'email corrigé dans la campagne
// resterait faux sur la fiche affaire.
//
// Les champs liés se répercutent donc dans les deux sens — mais jamais en
// silence : celui qui modifie voit d'abord, dans une fenêtre de confirmation,
// ce que sa modification va changer de l'autre côté. Le serveur refuse une
// modification à portée croisée tant qu'elle n'est pas confirmée
// explicitement, si bien qu'aucun chemin d'appel ne peut contourner l'écran.
//
// Ne sont PAS liés : l'enseigne, le magasin et la ville. Ils appartiennent au
// magasin, pas au contact, et les modifier depuis un lead reviendrait à
// réécrire une fiche magasin partagée par d'autres affaires.

import { prisma } from '@/lib/prisma';
import { normalizeCivility, normalizeEmail } from '@/lib/campaigns/leadFields';

/** Un champ partagé, de part et d'autre du lien. */
type LinkedField = {
  /** Nom côté Lead. */
  lead: 'email' | 'civility' | 'lastName' | 'jobTitle' | 'phone';
  /** Nom côté Deal. */
  deal: 'dealEmail' | 'contactCivilite' | 'contactLastName' | 'contactPosition' | 'contactPhone';
  label: string;
  /**
   * Valeurs acceptées côté affaire, quand le CRM en impose une liste.
   * Une valeur hors liste n'est pas répercutée : on le dit plutôt que de
   * faire échouer l'enregistrement.
   */
  dealAllowed?: readonly string[];
  /** Normalisation appliquée avant comparaison et écriture. */
  normalize?: (value: string) => string;
};

export const LINKED_FIELDS: readonly LinkedField[] = [
  { lead: 'email',    deal: 'dealEmail',        label: 'Email',          normalize: normalizeEmail },
  { lead: 'civility', deal: 'contactCivilite',  label: 'Civilité',       normalize: normalizeCivility },
  { lead: 'lastName', deal: 'contactLastName',  label: 'Nom de famille' },
  { lead: 'phone',    deal: 'contactPhone',     label: 'Téléphone' },
  // Le CRM impose une liste fermée pour le poste : un poste libre saisi côté
  // lead (« Responsable adjoint ») ne peut pas y entrer.
  { lead: 'jobTitle', deal: 'contactPosition',  label: 'Poste',
    dealAllowed: ['', 'Directeur', 'Adhérent', 'RH'] },
] as const;

/** Une répercussion à venir, telle qu'on la montre avant d'agir. */
export type LinkImpact = {
  field: string;
  label: string;
  from: string;
  to: string;
  /** Renseigné quand la valeur ne peut pas être répercutée, avec la raison. */
  blocked?: string;
};

export type LinkPreview = {
  /** Description de l'autre côté : « l'affaire Carrefour Lille ». */
  target: string;
  /** Vers quoi va la répercussion. */
  direction: 'toDeal' | 'toLead';
  impacts: LinkImpact[];
};

const text = (value: unknown): string => (value == null ? '' : String(value)).trim();

/**
 * Comment nommer l'affaire dans la fenêtre de confirmation.
 * Le nom du magasin porte souvent déjà l'enseigne (« Carrefour Lille ») : la
 * répéter donnerait « l'affaire Carrefour Carrefour Lille ».
 */
function dealLabel(brand?: string | null, store?: string | null): string {
  const b = text(brand);
  const s = text(store);
  if (!b && !s) return "l'affaire liée";
  if (!s) return `l'affaire « ${b} »`;
  const full = s.toLowerCase().startsWith(b.toLowerCase()) ? s : [b, s].filter(Boolean).join(' ');
  return `l'affaire « ${full} »`;
}

// ─── Sens lead → affaire ──────────────────────────────────────────────────

/**
 * Ce qu'une modification de lead changerait sur son affaire.
 * Renvoie null quand le lead n'est lié à aucune affaire, ou que rien de
 * partagé ne change.
 */
export async function previewLeadToDeal(
  leadId: string,
  changes: Record<string, unknown>,
): Promise<LinkPreview | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      dealId: true,
      email: true, civility: true, lastName: true, jobTitle: true, phone: true,
    },
  });
  if (!lead?.dealId) return null;

  const deal = await prisma.deal.findUnique({
    where: { id: lead.dealId },
    select: {
      id: true, dealEmail: true, contactCivilite: true, contactLastName: true,
      contactPosition: true, contactPhone: true,
      store: { select: { name: true, brand: { select: { name: true } } } },
    },
  });
  if (!deal) return null;

  const impacts: LinkImpact[] = [];
  for (const field of LINKED_FIELDS) {
    if (!(field.lead in changes)) continue;
    const next = field.normalize ? field.normalize(text(changes[field.lead])) : text(changes[field.lead]);

    // Rien ne se répercute si l'utilisateur ne CHANGE pas ce champ. Sans cette
    // condition, un simple écart préexistant entre les deux fiches ouvrirait
    // la fenêtre de confirmation à chaque enregistrement, pour un champ que
    // personne n'a touché.
    if (next === text(lead[field.lead])) continue;

    const current = text(deal[field.deal]);
    if (next === current) continue;

    if (field.dealAllowed && !field.dealAllowed.includes(next)) {
      impacts.push({
        field: field.deal, label: field.label, from: current, to: next,
        blocked: "l'affaire n'accepte que Directeur, Adhérent ou RH",
      });
      continue;
    }
    impacts.push({ field: field.deal, label: field.label, from: current, to: next });
  }

  if (impacts.length === 0) return null;

  return {
    target: dealLabel(deal.store?.brand?.name, deal.store?.name),
    direction: 'toDeal',
    impacts,
  };
}

/** Applique à l'affaire les répercussions non bloquées. */
export async function applyLeadToDeal(preview: LinkPreview, dealId: string): Promise<void> {
  const data: Record<string, string> = {};
  for (const impact of preview.impacts) {
    if (impact.blocked) continue;
    data[impact.field] = impact.to;
  }
  if (Object.keys(data).length === 0) return;
  await prisma.deal.update({ where: { id: dealId }, data });
}

// ─── Sens affaire → lead ──────────────────────────────────────────────────

/** Ce qu'une modification d'affaire changerait sur le lead qui en vient. */
export async function previewDealToLead(
  dealId: string,
  changes: Record<string, unknown>,
): Promise<(LinkPreview & { leadId: string }) | null> {
  const lead = await prisma.lead.findFirst({
    where: { dealId },
    select: {
      id: true, email: true, civility: true, lastName: true,
      jobTitle: true, phone: true,
    },
  });
  if (!lead) return null;

  // Valeurs actuelles de l'affaire : une répercussion ne part que d'un
  // changement réel, pas d'un écart déjà présent entre les deux fiches.
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      dealEmail: true, contactCivilite: true, contactLastName: true,
      contactPosition: true, contactPhone: true,
    },
  });
  if (!deal) return null;

  const impacts: LinkImpact[] = [];
  for (const field of LINKED_FIELDS) {
    if (!(field.deal in changes)) continue;
    const next = field.normalize ? field.normalize(text(changes[field.deal])) : text(changes[field.deal]);
    if (next === text(deal[field.deal])) continue;

    const current = text(lead[field.lead]);
    if (next === current) continue;

    // L'email identifie un lead : s'il est déjà pris par un autre, on ne
    // répercute pas — deux leads ne peuvent pas porter la même adresse.
    if (field.lead === 'email' && next) {
      const taken = await prisma.lead.findUnique({ where: { email: next }, select: { id: true } });
      if (taken && taken.id !== lead.id) {
        impacts.push({
          field: field.lead, label: field.label, from: current, to: next,
          blocked: 'un autre lead porte déjà cette adresse',
        });
        continue;
      }
    }

    impacts.push({ field: field.lead, label: field.label, from: current, to: next });
  }

  if (impacts.length === 0) return null;

  const name = [lead.civility, lead.lastName].filter(Boolean).join(' ') || lead.email;
  return {
    leadId: lead.id,
    target: `le lead « ${name} »`,
    direction: 'toLead',
    impacts,
  };
}

/** Applique au lead les répercussions non bloquées, et le journalise. */
export async function applyDealToLead(preview: LinkPreview, leadId: string, userName?: string): Promise<void> {
  const data: Record<string, string | null> = {};
  for (const impact of preview.impacts) {
    if (impact.blocked) continue;
    // Un champ vidé côté affaire vide le champ côté lead : c'est une
    // correction, pas une perte d'information.
    data[impact.field] = impact.to || null;
  }
  if (Object.keys(data).length === 0) return;

  await prisma.lead.update({ where: { id: leadId }, data });
  await prisma.leadEvent.create({
    data: {
      leadId,
      type: 'updated',
      label: `Mis à jour depuis l'affaire du CRM : ${preview.impacts
        .filter(impact => !impact.blocked)
        .map(impact => `${impact.label} → « ${impact.to || 'vide'} »`)
        .join(', ')}`,
      userName: userName || null,
    },
  });
}
