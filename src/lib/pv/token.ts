// src/lib/pv/token.ts
//
// Jetons d'invitation du parcours boucher.
//
// Deux règles tiennent toute la sécurité de la page publique :
//
//  1. Le jeton est TIRÉ AU HASARD (32 octets d'aléa cryptographique, encodés en
//     base64url) : il n'est ni devinable, ni énumérable. Aucune donnée
//     personnelle ne transite donc par l'URL — ni l'e-mail, ni le nom du
//     magasin, ni un identifiant interne.
//
//  2. Seule son EMPREINTE est stockée. La base ne contient jamais le jeton en
//     clair : qui lirait la table PvInvite ne pourrait pas ouvrir les pages des
//     magasins. Le même principe que pour un mot de passe, sans le sel — inutile
//     ici puisque le secret fait déjà 256 bits d'entropie (aucune attaque par
//     dictionnaire n'a de prise).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Longueur attendue d'un jeton encodé (32 octets en base64url = 43 caractères). */
const TOKEN_BYTES = 32;

/** Nouveau jeton, à mettre dans l'URL du mail et nulle part ailleurs. */
export function generatePvToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Empreinte stockée en base (hexadécimal, 64 caractères). */
export function hashPvToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Filtre de forme, avant toute requête : un jeton qui ne ressemble pas à un
 * jeton n'a pas besoin d'aller déranger la base.
 */
export function looksLikePvToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(value);
}

/**
 * Comparaison de deux empreintes à temps constant. La recherche se fait par
 * index sur `tokenHash`, mais quand une empreinte doit être comparée à la main
 * (revérification), autant ne pas laisser fuir d'information par le temps de
 * réponse.
 */
export function sameHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
