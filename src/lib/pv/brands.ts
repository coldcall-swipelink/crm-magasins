// src/lib/pv/brands.ts
//
// Enseigne → identifiant court (« slug »), pour la page du parcours.
//
// La page affiche un logo par enseigne et retombe sur un pictogramme neutre
// quand elle ne connaît pas le slug : renvoyer un slug inconnu n'a donc aucune
// conséquence fâcheuse, mais renvoyer le BON slug fait apparaître le logo.
//
// Les noms d'enseigne du CRM sont saisis à la main et varient (« E.Leclerc »,
// « Leclerc Drive », « SUPER U », « U Express »…) : on reconnaît la marque par
// motif plutôt que par égalité stricte.

/** Minuscules, sans accents ni ponctuation, espaces compactés. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Motifs reconnus, dans l'ordre. Netto et Utile passent AVANT leurs maisons
 * mères (Intermarché, U) car ce sont des enseignes distinctes aux yeux d'un
 * directeur de magasin.
 */
const REGLES: Array<[RegExp, string]> = [
  [/\bleclerc\b/, 'leclerc'],
  [/\bnetto\b/, 'netto'],
  [/\bintermarche\b|\bitm\b/, 'intermarche'],
  [/\bcarrefour\b/, 'carrefour'],
  [/\bauchan\b/, 'auchan'],
  [/\butile\b/, 'u'],
  [/\b(super|hyper|express|marche)?\s*u\b|\bu\s*(express|marche)\b/, 'u'],
  [/\bcasino\b|\bgeant\b/, 'casino'],
  [/\bcora\b/, 'cora'],
  [/\bmonoprix\b|\bmonop\b/, 'monoprix'],
  [/\bfranprix\b/, 'franprix'],
  [/\bgrand frais\b/, 'grandfrais'],
  [/\bcolruyt\b/, 'colruyt'],
  [/\bmatch\b/, 'match'],
  [/\bspar\b/, 'spar'],
  [/\bvival\b/, 'vival'],
  [/\bproxi\b/, 'proxi'],
  [/\blidl\b/, 'lidl'],
  [/\baldi\b/, 'aldi'],
  [/\bbi1\b/, 'bi1'],
];

/** Slug d'enseigne (« leclerc », « intermarche », « u »…), ou chaîne vide. */
export function brandSlug(brandName: string | null | undefined): string {
  const nom = normalize(brandName || '');
  if (!nom) return '';
  for (const [motif, slug] of REGLES) {
    if (motif.test(nom)) return slug;
  }
  // Enseigne inconnue : un slug lisible vaut mieux que rien (la page affichera
  // son pictogramme neutre).
  return nom.replace(/\s+/g, '-');
}
