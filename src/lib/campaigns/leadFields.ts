// src/lib/campaigns/leadFields.ts
//
// Tout ce qui décrit un lead SANS toucher à la base : statuts, champs
// standard, reconnaissance des colonnes d'un fichier importé, normalisation
// des valeurs.
//
// Ce fichier est volontairement séparé de src/lib/campaigns/leads.ts (qui,
// lui, écrit en base) : les composants React de l'onglet Campagnes affichent
// les libellés et les couleurs de statut, et ne doivent surtout pas entraîner
// le client Prisma dans le paquet envoyé au navigateur.

// ─── Statuts ──────────────────────────────────────────────────────────────

// Couleurs choisies pour rester lisibles sur le fond sombre de l'onglet :
// elles servent à la fois de texte, de bordure et de teinte de fond.
export const LEAD_STATUSES = [
  { key: 'new',            label: 'Nouveau',        color: '#94a3b8' },
  { key: 'contacted',      label: 'Contacté',       color: '#38bdf8' },
  { key: 'replied',        label: 'A répondu',      color: '#a78bfa' },
  { key: 'interested',     label: 'Intéressé',      color: '#4ade80' },
  { key: 'not_interested', label: 'Pas intéressé',  color: '#f87171' },
  { key: 'customer',       label: 'Client',         color: '#2dd4bf' },
  { key: 'unsubscribed',   label: 'Désinscrit',     color: '#fbbf24' },
  { key: 'bounced',        label: 'Adresse morte',  color: '#c084fc' },
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number]['key'];

export function isLeadStatus(value: string): value is LeadStatus {
  return LEAD_STATUSES.some(s => s.key === value);
}

export function statusLabel(status: string): string {
  return LEAD_STATUSES.find(s => s.key === status)?.label ?? status;
}

export function statusColor(status: string): string {
  return LEAD_STATUSES.find(s => s.key === status)?.color ?? '#64748b';
}

/** Statuts qui interdisent définitivement l'envoi (hors campagne en cours). */
export const BLOCKING_STATUSES: readonly string[] = ['unsubscribed', 'bounced', 'not_interested'];

// ─── Champs standard et reconnaissance des colonnes ───────────────────────

/** Champ standard d'un lead + libellés de colonnes qui le désignent. */
export const LEAD_FIELDS = [
  { key: 'email',     label: 'Email',     required: true,
    aliases: ['email', 'e-mail', 'mail', 'courriel', 'adresse email', 'email address', 'work email'] },
  { key: 'civility',  label: 'Civilité',  required: false,
    aliases: ['civilite', 'civilité', 'titre', 'salutation', 'genre', 'mr/mme'] },
  { key: 'firstName', label: 'Prénom',    required: false,
    aliases: ['prenom', 'prénom', 'first name', 'firstname', 'first_name', 'given name'] },
  { key: 'lastName',  label: 'Nom',       required: false,
    aliases: ['nom', 'nom de famille', 'last name', 'lastname', 'last_name', 'surname', 'family name'] },
  { key: 'jobTitle',  label: 'Poste',     required: false,
    aliases: ['poste', 'fonction', 'job title', 'jobtitle', 'job_title', 'titre du poste', 'role', 'metier', 'métier'] },
  { key: 'company',   label: 'Enseigne',  required: false,
    aliases: ['enseigne', 'entreprise', 'societe', 'société', 'company', 'organisation', 'organization', 'marque', 'magasin'] },
  { key: 'phone',     label: 'Téléphone', required: false,
    aliases: ['telephone', 'téléphone', 'tel', 'phone', 'mobile', 'portable', 'numero', 'numéro'] },
  { key: 'website',   label: 'Site web',  required: false,
    aliases: ['site', 'site web', 'website', 'url', 'domaine', 'domain', 'web'] },
  { key: 'city',      label: 'Ville',     required: false,
    aliases: ['ville', 'city', 'commune', 'localite', 'localité'] },
  { key: 'country',   label: 'Pays',      required: false,
    aliases: ['pays', 'country'] },
] as const;

export type LeadFieldKey = (typeof LEAD_FIELDS)[number]['key'];

const FIELD_KEYS = new Set<string>(LEAD_FIELDS.map(f => f.key));

/** Comparaison de libellés insensible à la casse, aux accents et aux séparateurs. */
function normalizeHeader(header: string): string {
  return header
    .trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Nom de variable d'un champ personnalisé : « Effectif du magasin » →
 * « effectif_du_magasin ». C'est ce nom que l'on écrira {{entre accolades}}
 * dans les emails, il doit donc rester simple et stable.
 */
export function customFieldSlug(header: string): string {
  const slug = normalizeHeader(header).replace(/ +/g, '_');
  return slug || 'champ';
}

/** Cible d'une colonne : un champ standard, un champ personnalisé, ou rien. */
export type MappingTarget = LeadFieldKey | `custom:${string}` | '';

export type LeadMapping = Record<string, MappingTarget>;

/**
 * Correspondance proposée automatiquement à l'ouverture de l'aperçu.
 * Une colonne reconnue va vers son champ standard ; toutes les autres sont
 * conservées en champ personnalisé — on ne jette jamais une colonne sans que
 * l'utilisateur l'ait décidé.
 */
export function suggestMapping(headers: string[]): LeadMapping {
  const mapping: LeadMapping = {};
  const taken = new Set<string>();

  // Première passe : les correspondances exactes (« Email » → email). Elles
  // priment, pour qu'une colonne exacte ne se fasse pas voler sa place par une
  // colonne seulement approchante.
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (!normalized) continue;
    for (const field of LEAD_FIELDS) {
      if (taken.has(field.key)) continue;
      if (field.aliases.some(alias => normalizeHeader(alias) === normalized)) {
        mapping[header] = field.key;
        taken.add(field.key);
        break;
      }
    }
  }

  // Seconde passe : les approchantes (« Email pro » → email). On retient
  // l'alias le PLUS LONG qui apparaît dans l'en-tête, sinon « Nom de
  // l'entreprise » filerait vers « Nom » (3 lettres) au lieu d'« entreprise ».
  for (const header of headers) {
    if (mapping[header]) continue;
    const normalized = normalizeHeader(header);
    if (!normalized) continue;

    let best: { key: LeadFieldKey; length: number } | null = null;
    for (const field of LEAD_FIELDS) {
      if (taken.has(field.key)) continue;
      for (const alias of field.aliases) {
        const a = normalizeHeader(alias);
        if (!normalized.includes(a)) continue;
        if (!best || a.length > best.length) best = { key: field.key, length: a.length };
      }
    }
    if (best) {
      mapping[header] = best.key;
      taken.add(best.key);
    }
  }

  for (const header of headers) {
    if (!mapping[header]) mapping[header] = `custom:${customFieldSlug(header)}`;
  }
  return mapping;
}

// ─── Normalisation des valeurs ────────────────────────────────────────────

export function normalizeEmail(value: string): string {
  return (value || '').trim().toLowerCase();
}

/** Validation volontairement permissive : on refuse l'absurde, pas l'exotique. */
export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value);
  return /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i.test(email);
}

/** Civilité ramenée à une forme courte et homogène (M. / Mme). */
function normalizeCivility(value: string): string {
  const v = normalizeHeader(value);
  if (!v) return '';
  if (/^(m|mr|monsieur|mister|sir)$/.test(v)) return 'M.';
  if (/^(mme|mrs|ms|madame|miss|mlle|mademoiselle)$/.test(v)) return 'Mme';
  return value.trim();
}

export type LeadInput = {
  email: string;
  civility?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  company?: string;
  phone?: string;
  website?: string;
  city?: string;
  country?: string;
  customFields: Record<string, string>;
};

/** Applique la correspondance des colonnes à une ligne du fichier. */
export function applyMapping(row: Record<string, string>, mapping: LeadMapping): LeadInput {
  const lead: LeadInput = { email: '', customFields: {} };

  for (const [header, target] of Object.entries(mapping)) {
    if (!target) continue;
    const value = (row[header] || '').trim();
    if (!value) continue;

    if (target.startsWith('custom:')) {
      const slug = target.slice('custom:'.length);
      if (slug) lead.customFields[slug] = value;
      continue;
    }
    if (!FIELD_KEYS.has(target)) continue;

    if (target === 'email') lead.email = normalizeEmail(value);
    else if (target === 'civility') lead.civility = normalizeCivility(value);
    else (lead as Record<string, unknown>)[target] = value;
  }

  return lead;
}

/** Libellé d'affichage d'un lead : « M. Jean Dupont » ou, à défaut, son email. */
export function leadDisplayName(lead: {
  civility?: string | null; firstName?: string | null; lastName?: string | null; email: string;
}): string {
  const name = [lead.civility, lead.firstName, lead.lastName].filter(Boolean).join(' ').trim();
  return name || lead.email;
}
