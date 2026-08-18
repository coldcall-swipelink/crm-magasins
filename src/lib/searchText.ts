// src/lib/searchText.ts
//
// Normalisation des textes pour la recherche d'affaires. Objectif : qu'une
// saisie approximative retrouve quand même le magasin. « saint loudeac »,
// « Saint-Loudéac », « SAINT-LOUDÉAC » ou « saintloudéac » se ramènent tous à
// la même « clé de recherche » — saintloudeac — et c'est sur ces clés que la
// comparaison se fait, jamais sur le texte brut.
//
// Règles :
//   1. minuscules ;
//   2. lettres accentuées ou composées ramenées à leur équivalent ASCII
//      (é → e, ç → c, œ → oe, ß → ss…) ;
//   3. tout le reste — espaces, tirets, apostrophes, points, & … — supprimé.
//
// La même transformation est appliquée en base par src/lib/searchSql.ts, qui
// réutilise la table de correspondance construite ici : les deux
// implémentations produisent donc exactement les mêmes clés.

/**
 * Lettres que la décomposition Unicode (NFD) ne sépare pas de leur accent, ou
 * dont l'équivalent ASCII fait plusieurs caractères. Toujours en minuscules.
 */
const SPECIAL_LETTERS: Record<string, string> = {
  'œ': 'oe',
  'æ': 'ae',
  'ß': 'ss',
  'þ': 'th',
  'ø': 'o',
  'đ': 'd',
  'ð': 'd',
  'ł': 'l',
  'ŀ': 'l',
  'ı': 'i',
  'ħ': 'h',
  'ŧ': 't',
};

/**
 * Table de correspondance « lettre → équivalent ASCII », couvrant les blocs
 * latins courants (Latin-1 Supplement et Latin étendu A : français, espagnol,
 * allemand, portugais, italien, langues nordiques et d'Europe centrale).
 *
 * Elle est séparée en deux : `from`/`to` pour les lettres à équivalent unique
 * (directement exploitables par le `translate()` de PostgreSQL) et `multi`
 * pour les quelques lettres à équivalent multiple. Une lettre absente de la
 * table est simplement supprimée, des deux côtés — d'où l'importance d'une
 * table unique et partagée.
 */
function buildFoldTable(): { from: string; to: string; multi: Array<[string, string]> } {
  let from = '';
  let to = '';
  const multi: Array<[string, string]> = [];
  const add = (char: string, ascii: string) => {
    if (char.length !== 1 || from.includes(char) || multi.some(([c]) => c === char)) return;
    if (ascii.length === 1) { from += char; to += ascii; }
    else multi.push([char, ascii]);
  };

  for (const [char, ascii] of Object.entries(SPECIAL_LETTERS)) add(char, ascii);
  // Lettres accentuées : leur équivalent ASCII est obtenu en retirant les
  // diacritiques de la forme décomposée (é = e + accent aigu → e).
  for (let cp = 0x00c0; cp <= 0x017f; cp++) {
    const char = String.fromCodePoint(cp).toLowerCase();
    if (char.length !== 1) continue;
    const ascii = char.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (ascii === char || !/^[a-z0-9]$/.test(ascii)) continue;
    add(char, ascii);
  }
  return { from, to, multi };
}

export const FOLD_TABLE = buildFoldTable();

/**
 * Clé de recherche d'un texte : minuscules, sans accents, sans espaces ni
 * ponctuation. Chaîne vide si le texte ne contient rien d'exploitable.
 */
export function searchKey(value: string | null | undefined): string {
  if (!value) return '';
  let key = '';
  for (const char of value.toLowerCase()) {
    if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')) { key += char; continue; }
    const single = FOLD_TABLE.from.indexOf(char);
    if (single !== -1) { key += FOLD_TABLE.to[single]; continue; }
    const multi = FOLD_TABLE.multi.find(([c]) => c === char);
    if (multi) key += multi[1];
  }
  return key;
}

/** Vrai si `text` contient `query`, accents / ponctuation / casse ignorés. */
export function searchKeyIncludes(text: string | null | undefined, query: string): boolean {
  const key = searchKey(query);
  return key.length > 0 && searchKey(text).includes(key);
}

/**
 * Localise la requête dans un texte en ignorant accents, ponctuation et casse,
 * et renvoie les bornes correspondantes **dans le texte d'origine** (pour le
 * surlignage des résultats). `null` si aucune correspondance.
 */
export function findSearchMatch(
  text: string,
  query: string,
): { start: number; end: number } | null {
  const key = searchKey(query);
  if (!key || !text) return null;

  // On normalise caractère par caractère en gardant, pour chaque caractère de
  // la clé, l'index d'origine dont il provient (un caractère peut donner 0, 1
  // ou 2 caractères de clé : « - » → rien, « é » → « e », « œ » → « oe »).
  let normalized = '';
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const piece = searchKey(text[i]);
    for (let j = 0; j < piece.length; j++) origin.push(i);
    normalized += piece;
  }

  const idx = normalized.indexOf(key);
  if (idx === -1) return null;
  return { start: origin[idx], end: origin[idx + key.length - 1] + 1 };
}
