// src/lib/campaigns/render.ts
//
// Fabrication de l'email d'une étape de campagne : variables de
// personnalisation, corps texte ou HTML, signature, pixel de suivi et lien de
// désinscription.
//
// Les variables s'écrivent {{prenom}} et acceptent une valeur de repli :
// {{prenom|there}} rend « there » quand le lead n'a pas de prénom. C'est la
// parade au « Bonjour , » qui trahit un email de masse.

import { leadDisplayName } from '@/lib/campaigns/leadFields';

/** Le minimum dont le rendu a besoin : n'importe quel lead fait l'affaire. */
export type RenderableLead = {
  email: string;
  civility?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  contactCalling?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  phone?: string | null;
  website?: string | null;
  city?: string | null;
  country?: string | null;
  customFields?: unknown;
};

/** Variables standard d'un lead, en français — celles proposées à l'écran. */
export const STANDARD_VARIABLES = [
  { name: 'civilite',    description: 'Monsieur / Madame' },
  { name: 'prenom',      description: 'Prénom du lead' },
  { name: 'nom',         description: 'Nom de famille' },
  { name: 'nom_complet', description: 'Civilité + prénom + nom' },
  { name: 'contact_calling', description: "Interlocuteur appelé, repris de l'affaire du CRM" },
  { name: 'poste',       description: 'Fonction' },
  { name: 'enseigne',    description: 'Entreprise / enseigne' },
  { name: 'ville',       description: 'Ville' },
  { name: 'pays',        description: 'Pays' },
  { name: 'email',       description: 'Adresse du lead' },
  { name: 'telephone',   description: 'Téléphone' },
  { name: 'site',        description: 'Site web' },
  { name: 'expediteur',  description: "Nom affiché de la boîte d'envoi" },
  { name: 'prenom_expediteur', description: "Prénom de l'expéditeur" },
] as const;

/** Toutes les variables disponibles pour un lead, champs personnalisés inclus. */
export function leadVariables(
  lead: RenderableLead,
  sender?: { displayName?: string | null; email?: string | null },
): Record<string, string> {
  const custom = (lead.customFields && typeof lead.customFields === 'object')
    ? lead.customFields as Record<string, unknown>
    : {};

  const senderName = (sender?.displayName || '').trim();
  const variables: Record<string, string> = {
    civilite:    lead.civility  || '',
    prenom:      lead.firstName || '',
    nom:         lead.lastName  || '',
    nom_complet: leadDisplayName(lead),
    // Interlocuteur repris du CRM (« Contact calling » de la fiche affaire).
    contact_calling: lead.contactCalling || '',
    poste:       lead.jobTitle  || '',
    enseigne:    lead.company   || '',
    ville:       lead.city      || '',
    pays:        lead.country   || '',
    email:       lead.email,
    telephone:   lead.phone     || '',
    site:        lead.website   || '',
    expediteur:  senderName,
    // « Bilal Yacouti - Swipelink » → « Bilal ».
    prenom_expediteur: senderName.split(/[\s-]+/)[0] || '',
  };

  // Les champs personnalisés ne peuvent pas écraser une variable standard :
  // sinon une colonne « email » mal mappée changerait le sens du modèle.
  for (const [key, value] of Object.entries(custom)) {
    if (!(key in variables)) variables[key] = value == null ? '' : String(value);
  }
  return variables;
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|([^}]*))?\}\}/g;

export type RenderResult = { text: string; missing: string[] };

/**
 * Remplace les variables d'un texte.
 * Une variable inconnue OU vide rend sa valeur de repli, ou une chaîne vide,
 * et son nom remonte dans `missing` : l'aperçu peut ainsi prévenir avant le
 * départ plutôt qu'après.
 */
export function renderTemplate(template: string, variables: Record<string, string>): RenderResult {
  const missing = new Set<string>();
  const text = (template || '').replace(TOKEN, (_match, name: string, fallback?: string) => {
    const value = variables[name];
    if (value) return value;
    missing.add(name);
    return (fallback ?? '').trim();
  });
  return { text, missing: Array.from(missing) };
}

/** Échappement HTML — appliqué à tout ce qui vient d'un lead ou d'un texte. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Corps texte → HTML sobre.
 * Volontairement minimal (pas de tableau, pas d'image, pas de style exotique) :
 * un email de prospection qui ressemble à un email écrit à la main passe
 * beaucoup mieux les filtres qu'une maquette commerciale.
 */
export function textToHtml(text: string): string {
  const paragraphs = (text || '').split(/\n{2,}/).map(block =>
    `<p style="margin:0 0 14px">${escapeHtml(block).replace(/\n/g, '<br />')}</p>`,
  );
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;`
    + `font-size:15px;line-height:1.55;color:#111">${paragraphs.join('')}</div>`;
}

/** Version texte brut d'un corps HTML — le pendant `text/plain` de l'envoi. */
export function htmlToText(html: string): string {
  return (html || '')
    // Ce qui n'est pas du contenu : commentaires (y compris les conditionnels
    // Outlook), feuilles de style, scripts et en-tête du document.
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&rarr;/g, '→')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    // L'indentation du HTML n'a rien à faire dans le texte.
    .split('\n').map(line => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Adresse publique du CRM, base des liens de suivi et de désinscription. */
export function appUrl(): string {
  const url = (process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || '').trim();
  if (!url) return '';
  return url.startsWith('http') ? url.replace(/\/$/, '') : `https://${url.replace(/\/$/, '')}`;
}

export function trackingUrl(trackingId: string): string {
  const base = appUrl();
  return base ? `${base}/api/campaigns/track/${trackingId}.gif` : '';
}

export function unsubscribeUrl(token: string): string {
  const base = appUrl();
  return base ? `${base}/api/campaigns/unsubscribe/${token}` : '';
}

export type BuildEmailOptions = {
  subjectTemplate: string;
  bodyTemplate: string;
  useHtml: boolean;
  variables: Record<string, string>;
  /** Signature HTML de la boîte d'envoi, ajoutée sous le corps. */
  signatureHtml?: string | null;
  /** Identifiant du pixel de suivi. Absent = pas de suivi d'ouverture. */
  trackingId?: string | null;
  /** Jeton de désinscription. Absent = pas de lien. */
  unsubscribeToken?: string | null;
};

export type BuiltEmail = {
  subject: string;
  html: string;
  text: string;
  missing: string[];
  unsubscribeUrl: string | null;
};

/** Assemble l'email complet d'une étape pour un lead donné. */
export function buildEmail(options: BuildEmailOptions): BuiltEmail {
  const subject = renderTemplate(options.subjectTemplate, options.variables);
  const body = renderTemplate(options.bodyTemplate, options.variables);

  let html = options.useHtml ? body.text : textToHtml(body.text);

  if (options.signatureHtml?.trim()) {
    html += `<div style="margin-top:18px">${options.signatureHtml}</div>`;
  }

  const unsubUrl = options.unsubscribeToken ? unsubscribeUrl(options.unsubscribeToken) : '';
  if (unsubUrl) {
    html += `<div style="margin-top:22px;font-size:11px;color:#9ca3af;`
      + `font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">`
      + `<a href="${unsubUrl}" style="color:#9ca3af">Se désinscrire de ces emails</a></div>`;
  }

  // Le pixel se place en tout dernier : s'il est bloqué, rien ne bouge dans la
  // mise en page. Largeur et hauteur à 1, sans bordure.
  const pixel = options.trackingId ? trackingUrl(options.trackingId) : '';
  if (pixel) {
    html += `<img src="${pixel}" width="1" height="1" alt="" `
      + `style="display:block;width:1px;height:1px;border:0" />`;
  }

  return {
    subject: subject.text,
    html,
    // Le texte brut ignore pixel et signature HTML : il ne sert qu'aux clients
    // qui n'affichent pas le HTML.
    text: options.useHtml ? htmlToText(body.text) : body.text,
    missing: Array.from(new Set([...subject.missing, ...body.missing])),
    unsubscribeUrl: unsubUrl || null,
  };
}

/** Sujet d'une relance dans le fil : « Re: … », sans empiler les « Re: ». */
export function threadSubject(original: string): string {
  const clean = (original || '').trim();
  return /^re\s*:/i.test(clean) ? clean : `Re: ${clean}`;
}
