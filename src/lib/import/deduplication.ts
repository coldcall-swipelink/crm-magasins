// src/lib/import/deduplication.ts
import { canonicalBrand, normalizeText } from '@/lib/utils';
import type { MappedRow } from './csvParser';

/** Sous-ensemble de champs suffisant pour calculer une clé de déduplication.
 *  Permet de réutiliser `buildDeduplicationKey` hors import (ex. réalignement
 *  de la clé d'un magasin existant après un changement d'enseigne/nom). */
export type DeduplicationInput = Pick<
  MappedRow,
  'brand' | 'city' | 'storeName' | 'siret' | 'externalId'
>;

/**
 * Génère une clé de déduplication unique par magasin.
 * Priorité : identifiant externe > SIRET > clé normalisée enseigne+ville+nom
 *
 * L'enseigne est CANONICALISÉE (cf. canonicalBrand) : toutes les variantes d'une
 * même bannière produisent le même segment. Concrètement la bannière « U »
 * (« U », « Super U », « Hyper U »…) donne toujours `k:u|…`, si bien qu'un
 * magasin importé une fois en « U » puis réimporté en « Super U » garde la même
 * clé et se met à jour au lieu d'être dupliqué.
 */
export function buildDeduplicationKey(row: DeduplicationInput): string {
  if (row.externalId?.trim()) {
    return `ext:${row.externalId.trim()}`;
  }
  if (row.siret?.trim()) {
    return `siret:${row.siret.trim()}`;
  }

  const brand = canonicalBrand(row.brand || '');
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
