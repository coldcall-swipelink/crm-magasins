// src/lib/campaigns/offerMatch.ts
//
// Reconnaissance d'un métier dans l'intitulé d'une offre d'emploi.
//
// Séparé de offerTriggers.ts (qui, lui, écrit en base) pour que l'écran de
// création d'une règle puisse essayer les termes en direct, sans aller-retour
// serveur et sans entraîner le client Prisma dans le paquet du navigateur.
//
// La règle de correspondance est volontairement simple, parce qu'elle doit
// être explicable à celui qui écrit les termes : un terme correspond quand il
// se trouve AU DÉBUT D'UN MOT de l'intitulé.
//
//   « boucher »  trouve  boucher · bouchère · bouchers · boucherie
//   « boucher »  ne trouve pas  « embouchure »
//
// C'est ce qui permet d'écrire un seul terme là où il faudrait sinon lister
// toutes les variantes de genre et de nombre.

/** Minuscules, sans accents, ponctuation ramenée à des espaces. */
export function normalizeOfferText(value: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Termes d'une règle, saisis séparés par des virgules, des points-virgules ou
 * des retours à la ligne. Les doublons et les entrées vides sont écartés ;
 * l'ordre de saisie est conservé, c'est celui qu'on réaffiche.
 */
export function parseKeywords(text: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const piece of (text || '').split(/[,;\n\r]+/)) {
    const term = piece.trim();
    if (!term) continue;
    const key = normalizeOfferText(term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    list.push(term);
  }
  return list;
}

/** L'intitulé sur lequel on cherche : le métier ET le titre de l'annonce. */
export function offerHaystack(offer: { title?: string | null; jobTitle?: string | null }): string {
  return normalizeOfferText(`${offer.jobTitle || ''} ${offer.title || ''}`);
}

const ESCAPE = /[.*+?^${}()|[\]\\]/g;

/**
 * Le premier terme de la liste qui apparaît en début de mot, sinon null.
 *
 * On cherche toutes les positions, pas seulement la première : dans
 * « embouchure boucher », « boucher » apparaît d'abord au milieu d'un mot
 * (à écarter) puis en début du suivant (à retenir). Un test sur la seule
 * première occurrence conclurait à tort qu'il n'y a pas de correspondance.
 */
function findTerm(haystack: string, terms: string[]): string | null {
  for (const term of terms) {
    const needle = normalizeOfferText(term);
    if (!needle) continue;
    // Le terme peut compter plusieurs mots (« chef de rayon ») : il est
    // cherché tel quel, espaces compris, précédé du début de la chaîne ou
    // d'une espace.
    const pattern = new RegExp(`(^| )${needle.replace(ESCAPE, '\\$&')}`);
    if (pattern.test(haystack)) return term;
  }
  return null;
}

export type OfferMatch =
  | { matched: true; keyword: string }
  | { matched: false; excludedBy?: string };

/**
 * L'offre correspond-elle à la règle ?
 *
 * Un terme d'exclusion l'emporte toujours : « boucher » sans « apprenti »
 * s'écrit en mettant « apprenti » dans les exclusions, et une offre
 * d'apprenti boucher est alors écartée même si elle contient « boucher ».
 */
export function matchOffer(
  offer: { title?: string | null; jobTitle?: string | null },
  rule: { keywords: string; exclude?: string },
): OfferMatch {
  const terms = parseKeywords(rule.keywords);
  if (terms.length === 0) return { matched: false };

  const haystack = offerHaystack(offer);
  if (!haystack) return { matched: false };

  const excluded = findTerm(haystack, parseKeywords(rule.exclude || ''));
  if (excluded) return { matched: false, excludedBy: excluded };

  const keyword = findTerm(haystack, terms);
  return keyword ? { matched: true, keyword } : { matched: false };
}

/**
 * Variables d'email alimentées par l'offre qui a déclenché l'inscription.
 *
 * Elles sont rangées dans les champs personnalisés du lead, ce qui les rend
 * utilisables tel quel dans les modèles ({{offre}}, {{offre_url}}…) — c'est
 * tout l'intérêt d'une campagne dédiée à un métier : l'email peut citer
 * l'annonce qui vient de sortir.
 */
export const OFFER_VARIABLES = [
  { name: 'offre',          description: "Intitulé de l'offre qui a déclenché l'inscription" },
  { name: 'offre_poste',    description: 'Métier relevé sur l\'annonce' },
  { name: 'offre_contrat',  description: 'Type de contrat (CDI, CDD…)' },
  { name: 'offre_url',      description: "Lien vers l'annonce" },
  { name: 'offre_source',   description: "Site d'où vient l'annonce" },
  { name: 'offre_date',     description: 'Date de publication annoncée' },
] as const;
