// src/lib/import/deduplication.ts
import { normalizeText } from '@/lib/utils';
import type { MappedRow } from './csvParser';

/**
 * Génère une clé de déduplication unique par magasin.
 * Priorité : identifiant externe > SIRET > clé normalisée enseigne+ville+nom
 */
export function buildDeduplicationKey(row: MappedRow): string {
  if (row.externalId?.trim()) {
    return `ext:${row.externalId.trim()}`;
  }
  if (row.siret?.trim()) {
    return `siret:${row.siret.trim()}`;
  }

  const brand = normalizeText(row.brand || '');
  const city  = normalizeText(row.city  || '');
  const name  = normalizeText(row.storeName || row.brand || '');

  return `k:${brand}|${city}|${name}`;
}

/**
 * Normalise le nom d'un magasin pour l'affichage et la recherche.
 */
export function normalizeStoreName(row: MappedRow): string {
  return normalizeText(row.storeName || row.brand || '');
}
