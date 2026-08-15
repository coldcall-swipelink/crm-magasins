// src/lib/phone/normalize.ts
// Normalisation et validation des numéros de téléphone français, partagées par
// toutes les sources de la recherche automatique (OpenStreetMap, Google Places,
// import CSV). Objectif : ramener « +33 3 20 12 34 56 », « 0320123456 »,
// « 03.20.12.34.56 » ou « 0033320123456 » à UNE seule forme comparable, pour ne
// jamais enregistrer deux fois le même numéro sous deux écritures différentes.

/** Numéro normalisé : forme canonique (comparaison / stockage) + affichage. */
export interface NormalizedPhone {
  /** Format E.164 : « +33320123456 ». Sert de clé de comparaison. */
  e164: string;
  /** Format national lisible : « 03 20 12 34 56 ». C'est ce qu'on affiche. */
  display: string;
  /** « fixe » (01–05, 09), « mobile » (06–07) ou « special » (08). */
  kind: 'fixe' | 'mobile' | 'special';
}

/**
 * Normalise un numéro français. Renvoie null si la valeur n'est pas un numéro
 * français exploitable (trop court, indicatif étranger, numéro court type 3949,
 * suite de chiffres bidon…).
 *
 * Les sources externes livrent souvent le numéro accompagné d'un commentaire
 * (« 03 20 12 34 56 (accueil) », « +33 3 20 12 34 56 ; +33 3 20 12 34 57 ») :
 * on ne garde que le PREMIER numéro rencontré, l'accueil du magasin étant
 * quasiment toujours cité en premier.
 */
export function normalizePhone(raw: string | null | undefined): NormalizedPhone | null {
  const input = (raw || '').trim();
  if (!input) return null;

  // Plusieurs numéros dans le même champ (OSM sépare par « ; », parfois « / »).
  const first = input.split(/[;/]|\bou\b/i)[0];

  // On ne garde que chiffres et « + », en supprimant les séparateurs usuels.
  let digits = first.replace(/[^\d+]/g, '');
  if (!digits) return null;

  // Préfixes internationaux : « +33 », « 0033 », « 33 » collé à un numéro à 9
  // chiffres commençant par 1–9.
  if (digits.startsWith('+33')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('0033')) digits = '0' + digits.slice(4);
  else if (/^33[1-9]\d{8}$/.test(digits)) digits = '0' + digits.slice(2);

  // Indicatif étranger restant → hors périmètre (le CRM ne cible que la France).
  if (digits.startsWith('+')) return null;

  // Certaines fiches omettent le 0 initial (« 320123456 »).
  if (/^[1-9]\d{8}$/.test(digits)) digits = '0' + digits;

  if (!/^0[1-9]\d{8}$/.test(digits)) return null;

  // Rejette les suites manifestement fictives (0000000000, 0123456789 saisi
  // comme exemple, chiffre unique répété).
  if (/^0(\d)\1{8}$/.test(digits)) return null;
  if (digits === '0123456789') return null;

  const prefix = digits.slice(0, 2);
  const kind: NormalizedPhone['kind'] =
    prefix === '06' || prefix === '07' ? 'mobile' : prefix === '08' ? 'special' : 'fixe';

  return {
    e164: '+33' + digits.slice(1),
    display: digits.replace(/(\d{2})(?=\d)/g, '$1 ').trim(),
    kind,
  };
}

/** Raccourci : renvoie la forme affichable, ou une chaîne vide. */
export function formatPhone(raw: string | null | undefined): string {
  return normalizePhone(raw)?.display ?? '';
}

/** Deux écritures désignent-elles le même numéro ? */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return !!na && !!nb && na.e164 === nb.e164;
}

/**
 * Un numéro « appelable » pour de la prospection : on écarte les numéros
 * spéciaux surtaxés (08xx), qui sont des serveurs vocaux de service client et
 * jamais le standard du magasin qu'on cherche à joindre.
 */
export function isProspectablePhone(phone: NormalizedPhone): boolean {
  return phone.kind !== 'special';
}
