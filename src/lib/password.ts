// Hachage de mots de passe basé sur scrypt (module `crypto` natif de Node —
// aucune dépendance externe à installer). Le format stocké est « salt:hash »,
// où salt et hash sont en hexadécimal. La comparaison utilise timingSafeEqual
// pour éviter les attaques temporelles.
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEYLEN = 64;

// Génère un hash prêt à stocker en base pour un mot de passe en clair.
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

// Vérifie un mot de passe en clair contre un hash « salt:hash » stocké.
// Renvoie false (jamais d'exception) si le format stocké est invalide.
export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, 'hex');
  const testBuf = scryptSync(password, salt, KEYLEN);
  // Les longueurs doivent correspondre pour timingSafeEqual.
  if (hashBuf.length !== testBuf.length) return false;
  return timingSafeEqual(hashBuf, testBuf);
}
