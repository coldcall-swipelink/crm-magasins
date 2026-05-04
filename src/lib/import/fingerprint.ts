// src/lib/import/fingerprint.ts
import { normalizeText, simpleHash } from '@/lib/utils';
import type { MappedRow } from './csvParser';

/**
 * Génère un fingerprint unique pour une offre d'emploi.
 * Priorité : identifiant externe > URL > hash métier
 *
 * Si une offre avec ce fingerprint existe déjà en base, elle ne sera pas créée
 * en doublon — seulement lastSeenAt sera mis à jour.
 */
export function buildOfferFingerprint(storeId: string, row: MappedRow): string {
  if (row.externalOfferId?.trim()) {
    return `ext:${row.externalOfferId.trim()}`;
  }

  if (row.url?.trim()) {
    return `url:${normalizeText(row.url.trim())}`;
  }

  // Hash basé sur les données métier
  const key = [
    storeId,
    normalizeText(row.offerTitle || ''),
    normalizeText(row.jobTitle   || ''),
    row.publishedAt || '',
    normalizeText(row.source     || ''),
    normalizeText(row.salary     || ''),
    normalizeText(row.contractType || ''),
  ].join('|');

  return `hash:${simpleHash(key)}`;
}
