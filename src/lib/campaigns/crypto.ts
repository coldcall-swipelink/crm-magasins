// src/lib/campaigns/crypto.ts
//
// Chiffrement des mots de passe des boîtes d'envoi.
//
// Pourquoi : contrairement à une clé d'API de routeur transactionnel, ces
// mots de passe ouvrent de VRAIES boîtes mail (Google Workspace, OVH). Ils
// sont saisis dans l'interface, donc stockés en base — jamais en clair.
//
// Comment : AES-256-GCM (chiffrement authentifié : toute altération du texte
// chiffré est détectée au déchiffrement), clé unique tirée de la variable
// d'environnement CAMPAIGN_SECRET_KEY, vecteur d'initialisation aléatoire par
// secret. Format stocké :
//
//   v1:<iv base64>:<tag base64>:<chiffré base64>
//
// Génération de la clé (32 octets) :  openssl rand -hex 32
//
// Sans CAMPAIGN_SECRET_KEY, l'outil refuse d'enregistrer une boîte plutôt que
// d'écrire un mot de passe en clair : l'interface affiche alors la marche à
// suivre. Les boîtes déjà enregistrées restent illisibles tant que la clé
// n'est pas remise — c'est le comportement voulu.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // taille recommandée pour GCM

/** Clé de chiffrement (32 octets), ou null si elle n'est pas configurée. */
function key(): Buffer | null {
  const raw = (process.env.CAMPAIGN_SECRET_KEY || '').trim();
  if (!raw) return null;

  // Acceptés : 64 caractères hexadécimaux (openssl rand -hex 32), ou base64.
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex');
  else buf = Buffer.from(raw, 'base64');

  if (buf.length !== 32) return null;
  return buf;
}

/** Vrai si le chiffrement est utilisable (clé présente et de bonne taille). */
export function isEncryptionConfigured(): boolean {
  return key() !== null;
}

/** Message d'erreur unique, affiché tel quel dans l'interface. */
export const MISSING_KEY_MESSAGE =
  "CAMPAIGN_SECRET_KEY absente ou invalide : impossible de chiffrer les mots de passe des boîtes d'envoi. "
  + 'Générez une clé avec « openssl rand -hex 32 » et ajoutez-la aux variables d\'environnement.';

/** Chiffre un secret. Lève si la clé n'est pas configurée. */
export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) throw new Error(MISSING_KEY_MESSAGE);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, k, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

/**
 * Déchiffre un secret produit par `encryptSecret`.
 * Lève si la clé manque, si le format est inconnu ou si le contenu a été
 * altéré (GCM refuse alors le déchiffrement).
 */
export function decryptSecret(stored: string): string {
  const k = key();
  if (!k) throw new Error(MISSING_KEY_MESSAGE);

  const parts = (stored || '').split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Secret illisible : format inattendu.');
  }
  const [, ivB64, tagB64, dataB64] = parts;

  try {
    const decipher = createDecipheriv(ALGO, k, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // GCM refuse le déchiffrement : la clé n'est pas celle qui a servi à
    // chiffrer. Le message brut (« Unsupported state or unable to authenticate
    // data ») n'aide personne ; celui-ci dit quoi faire.
    throw new Error(
      "Mot de passe illisible : il a été chiffré avec une autre valeur de CAMPAIGN_SECRET_KEY. "
      + 'Vérifiez que la clé est bien la même dans tous les environnements, puis ressaisissez le '
      + 'mot de passe de cette boîte.',
    );
  }
}

/**
 * Déchiffre sans lever : renvoie null si le secret est absent ou illisible.
 * Utilisé par le moteur d'envoi, qui doit signaler une boîte en panne plutôt
 * que de s'interrompre pour tout le monde.
 */
export function tryDecryptSecret(stored?: string | null): string | null {
  if (!stored) return null;
  try { return decryptSecret(stored); } catch { return null; }
}
