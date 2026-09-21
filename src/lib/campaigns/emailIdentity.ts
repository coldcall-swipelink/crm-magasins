// src/lib/campaigns/emailIdentity.ts
//
// Reconnaître le même interlocuteur derrière deux adresses voisines.
//
// Le cas observé, et il est courant chez les adhérents : on écrit à
// benjamin.marchand@socamaine.fr, la réponse arrive de
// benjamin.marchand@socamaine.leclerc. Même personne, même entreprise, deux
// extensions. Comparée à la lettre, l'adresse de réponse ne retrouve aucun
// lead : la réponse n'est rattachée à rien et ne compte nulle part.
//
// On compare donc sur une CLÉ : la partie locale, et le nom de l'entreprise
// sans son extension. « socamaine.fr » et « socamaine.leclerc » donnent tous
// deux « socamaine ».
//
// Ce rapprochement reste un SECOURS, jamais un raccourci : l'adresse exacte
// l'emporte toujours, et une clé qui désigne plusieurs leads ne désigne
// personne — mieux vaut ne rien conclure que d'attribuer la réponse au
// mauvais contact.

/**
 * Extensions à deux étiquettes : « co.uk » est une extension, pas un nom
 * d'entreprise. Sans cette liste, « acme.co.uk » donnerait la clé « co », et
 * toutes les entreprises britanniques se ressembleraient.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'co.kr',
  'com.br', 'com.mx', 'com.ar', 'co.za', 'com.tr', 'co.il',
  'com.sg', 'com.hk', 'com.cn', 'co.in', 'com.es', 'com.pl',
]);

/**
 * Étiquettes trop génériques pour identifier quoi que ce soit. Si la clé se
 * réduit à l'une d'elles, c'est que l'extension n'a pas été reconnue : on
 * renonce plutôt que de rapprocher au hasard.
 */
const GENERIC_LABELS = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'www', 'mail']);

/**
 * Clé de rapprochement d'une adresse, ou null quand elle ne peut pas servir.
 *
 *   benjamin.marchand@socamaine.fr       → benjamin.marchand@socamaine
 *   benjamin.marchand@socamaine.leclerc  → benjamin.marchand@socamaine
 *   benjamin.marchand@mail.socamaine.fr  → benjamin.marchand@socamaine
 */
export function identityKey(email: string): string | null {
  const clean = (email || '').trim().toLowerCase();
  const at = clean.lastIndexOf('@');
  if (at <= 0 || at === clean.length - 1) return null;

  const local = clean.slice(0, at);
  const domain = clean.slice(at + 1);
  if (!local || !domain.includes('.')) return null;

  // Un « + » sert à taguer une boîte (contact+crm@…) : il ne change pas
  // l'interlocuteur.
  const bareLocal = local.split('+')[0];
  if (!bareLocal) return null;

  const labels = domain.split('.').filter(Boolean);
  if (labels.length < 2) return null;

  // On retire l'extension — deux étiquettes quand c'en est une — puis on garde
  // l'étiquette enregistrable, celle qui nomme l'entreprise.
  const lastTwo = labels.slice(-2).join('.');
  const withoutSuffix = MULTI_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(0, -2) : labels.slice(0, -1);
  const org = withoutSuffix[withoutSuffix.length - 1];

  if (!org || org.length < 3 || GENERIC_LABELS.has(org)) return null;
  return `${bareLocal}@${org}`;
}

/** Deux adresses désignent-elles le même interlocuteur, extension mise à part ? */
export function sameIdentity(a: string, b: string): boolean {
  const ka = identityKey(a);
  const kb = identityKey(b);
  return ka !== null && ka === kb;
}
