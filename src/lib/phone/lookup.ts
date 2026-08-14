// src/lib/phone/lookup.ts
// Cœur de la recherche automatique des numéros de magasins.
//
// PRINCIPE — une cascade, du gratuit vers le payant :
//
//   1. Le magasin a déjà un numéro         → on ne fait rien.
//   2. OpenStreetMap (gratuit, sans clé)   → couvre une bonne part des grandes
//      enseignes, en UNE requête par « enseigne × département ».
//   3. Google Places (payant, optionnel)   → uniquement le reliquat, c'est-à-dire
//      les magasins qu'OSM n'a pas permis de trancher.
//
// VALIDATION — le risque n'est pas de ne pas trouver de numéro, c'est d'en
// trouver un MAUVAIS (le Carrefour de la ville d'à côté). Chaque candidat est
// donc noté sur des indices vérifiables : enseigne présente dans le nom, code
// postal identique, ville identique, distance au magasin géocodé. Selon la note :
//
//   • note élevée   → « trouve »      : le numéro est enregistré automatiquement ;
//   • note moyenne  → « a_verifier »  : le numéro part dans une file de revue où
//                                       il suffit d'un clic pour valider/rejeter ;
//   • aucun candidat→ « introuvable » : à traiter à la main (ou à retenter plus
//                                       tard avec Google activé).
//
// Rien n'est jamais écrasé : un numéro déjà saisi à la main reste intact.

import type { PrismaClient } from '@prisma/client';
import { normalizeText, canonicalBrand } from '@/lib/utils';
import { geocodeStore } from '@/lib/geocode';
import { distanceKm, departmentCode } from './geo';
import { normalizePhone, isProspectablePhone } from './normalize';
import {
  createOsmCache,
  fetchBrandPoisAround,
  fetchBrandPoisInDepartment,
  type OsmCache,
  type OsmPoi,
} from './osm';
import { isGoogleConfigured, searchPlaces, GooglePlacesError, type GooglePlace } from './google';

// ─── Seuils de décision ──────────────────────────────────────────────────────
/** Au-dessus : le numéro est enregistré sans intervention humaine. */
const AUTO_THRESHOLD = 6;
/** Au-dessus : le numéro est proposé dans la file de revue. */
const REVIEW_THRESHOLD = 3;

export type PhoneLookupStatus = 'trouve' | 'a_verifier' | 'introuvable' | 'erreur';
export type PhoneSource = 'osm' | 'google' | 'manuel' | 'import';

/** Un numéro proposé pour un magasin, avec de quoi juger sur pièces. */
export interface PhoneCandidate {
  /** Numéro affichable : « 03 20 12 34 56 ». */
  phone: string;
  /** Forme canonique, pour dédoublonner les candidats. */
  e164: string;
  source: 'osm' | 'google';
  /** Nom de l'établissement chez la source (à comparer au magasin). */
  name: string;
  address: string;
  city: string;
  postalCode: string;
  /** Distance au magasin géocodé, en km. Null si l'un des deux n'est pas localisé. */
  distanceKm: number | null;
  score: number;
  /** Indices ayant joué dans la note — affichés tels quels dans la file de revue. */
  reasons: string[];
  /** Lien vers la fiche d'origine (Google Maps / openstreetmap.org). */
  url: string;
}

/** Magasin tel qu'attendu par la recherche (sous-ensemble de Store). */
export interface StoreForLookup {
  id: string;
  name: string;
  city: string;
  postalCode: string;
  department: string;
  address: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
  brand: { name: string } | null;
}

export interface StoreLookupResult {
  storeId: string;
  /** Libellé lisible du magasin, pour les journaux et la file de revue. */
  label: string;
  status: PhoneLookupStatus;
  /** Numéro retenu (vide si « a_verifier » ou « introuvable »). */
  phone: string;
  source: PhoneSource | '';
  /** Meilleurs candidats, triés par note décroissante (3 au maximum). */
  candidates: PhoneCandidate[];
  /** Message d'erreur éventuel (statut « erreur »). */
  error?: string;
}

export interface LookupOptions {
  /** Interroger Google Places pour le reliquat (par défaut : si une clé existe). */
  useGoogle?: boolean;
  /** Cache OSM partagé par un lot (indispensable au traitement de masse). */
  osmCache?: OsmCache;
  /**
   * Géocoder le magasin s'il ne l'est pas encore. Les coordonnées améliorent
   * beaucoup la validation (distance) : activé par défaut.
   */
  geocode?: boolean;
  /** Interrogation OSM resserrée autour du magasin (recherche à l'unité). */
  around?: boolean;
}

// ─── Libellés ────────────────────────────────────────────────────────────────

export function storeLabel(store: StoreForLookup): string {
  return [store.brand?.name, store.name, store.city].filter(Boolean).join(' — ');
}

/** Enseigne exploitable pour la recherche (repli sur le nom du magasin). */
function brandOf(store: StoreForLookup): string {
  return (store.brand?.name || '').trim() || store.name.trim();
}

/**
 * Requête textuelle envoyée à Google, calquée sur ce qu'on taperait dans Maps :
 * « Enseigne Nom-du-magasin Code-postal Ville ». Le nom du magasin est omis
 * quand il ne fait que répéter la ville ou l'enseigne.
 */
export function buildSearchQuery(store: StoreForLookup): string {
  const brand = brandOf(store);
  const parts = [brand];
  const name = store.name.trim();
  const normName = normalizeText(name);
  if (name && normName !== normalizeText(store.city) && normName !== normalizeText(brand)) {
    parts.push(name);
  }
  if (store.postalCode) parts.push(store.postalCode);
  if (store.city) parts.push(store.city);
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

// ─── Notation des candidats ──────────────────────────────────────────────────

/** Mots significatifs d'un libellé (les mots d'un caractère sont ignorés). */
function tokens(value: string): string[] {
  return normalizeText(value).split(' ').filter((t) => t.length > 1);
}

/**
 * Note un candidat face au magasin visé. La note additionne des indices
 * indépendants ; aucun ne suffit seul à valider automatiquement, c'est leur
 * convergence (bonne enseigne + bon code postal + bonne ville / bonne distance)
 * qui autorise un enregistrement sans relecture.
 */
function scoreCandidate(
  store: StoreForLookup,
  candidate: Omit<PhoneCandidate, 'score' | 'reasons'>,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // 1. Enseigne — indice indispensable : sans elle, on ne sait pas si le
  // numéro est celui d'un magasin de l'enseigne ou du kebab d'en face.
  const brand = canonicalBrand(brandOf(store));
  const candidateName = normalizeText(candidate.name);
  const brandWords = tokens(brand);
  const brandMatch =
    brandWords.length > 0 && brandWords.every((w) => candidateName.includes(w));
  if (brandMatch) {
    score += 2;
    reasons.push('enseigne reconnue');
  } else {
    score -= 3;
    reasons.push('enseigne absente du nom');
  }

  // 2. Code postal — l'indice le plus discriminant en zone dense.
  const cpStore = (store.postalCode || '').replace(/\D/g, '');
  const cpCandidate = (candidate.postalCode || '').replace(/\D/g, '');
  if (cpStore && cpCandidate) {
    if (cpStore === cpCandidate) {
      score += 3;
      reasons.push('code postal identique');
    } else {
      score -= 2;
      reasons.push(`code postal différent (${cpCandidate})`);
    }
  }

  // 3. Ville.
  const cityStore = normalizeText(store.city);
  const cityCandidate = normalizeText(candidate.city);
  if (cityStore && cityCandidate) {
    if (cityStore === cityCandidate) {
      score += 2;
      reasons.push('ville identique');
    } else if (cityCandidate.includes(cityStore) || cityStore.includes(cityCandidate)) {
      score += 1;
      reasons.push('ville proche');
    } else {
      score -= 1;
      reasons.push(`ville différente (${candidate.city})`);
    }
  }

  // 4. Distance au magasin géocodé.
  if (candidate.distanceKm !== null) {
    const d = candidate.distanceKm;
    if (d <= 1) { score += 3; reasons.push('à moins d\'1 km'); }
    else if (d <= 3) { score += 2; reasons.push(`à ${d.toFixed(1)} km`); }
    else if (d <= 10) { score += 1; reasons.push(`à ${d.toFixed(1)} km`); }
    else if (d > 25) { score -= 4; reasons.push(`à ${Math.round(d)} km`); }
    else { reasons.push(`à ${Math.round(d)} km`); }
  }

  // 5. Nom du magasin (souvent un lieu-dit ou un quartier : « Villeneuve »,
  // « Grand Littoral ») retrouvé dans le nom du candidat.
  const nameWords = tokens(store.name).filter((w) => !brandWords.includes(w) && w !== cityStore);
  if (nameWords.length > 0 && nameWords.some((w) => candidateName.includes(w))) {
    score += 2;
    reasons.push('nom du magasin retrouvé');
  }

  // 6. Adresse (numéro + rue) commune.
  const streetWords = tokens(store.address).filter((w) => w.length > 3);
  const candidateAddress = normalizeText(candidate.address);
  if (streetWords.length >= 2 && streetWords.filter((w) => candidateAddress.includes(w)).length >= 2) {
    score += 2;
    reasons.push('adresse concordante');
  }

  return { score, reasons };
}

function distanceTo(
  store: StoreForLookup,
  lat: number | null,
  lon: number | null,
): number | null {
  if (store.latitude == null || store.longitude == null || lat == null || lon == null) return null;
  return distanceKm(
    { latitude: store.latitude, longitude: store.longitude },
    { latitude: lat, longitude: lon },
  );
}

function osmToCandidate(store: StoreForLookup, poi: OsmPoi): PhoneCandidate | null {
  const phone = normalizePhone(poi.phone);
  if (!phone || !isProspectablePhone(phone)) return null;

  const base = {
    phone: phone.display,
    e164: phone.e164,
    source: 'osm' as const,
    name: poi.name || poi.brand,
    address: [poi.street, poi.postalCode, poi.city].filter(Boolean).join(' '),
    city: poi.city,
    postalCode: poi.postalCode,
    distanceKm: distanceTo(store, poi.latitude, poi.longitude),
    url: `https://www.openstreetmap.org/${poi.osmId}`,
  };
  return { ...base, ...scoreCandidate(store, base) };
}

function googleToCandidate(store: StoreForLookup, place: GooglePlace): PhoneCandidate | null {
  const phone = normalizePhone(place.phone);
  if (!phone || !isProspectablePhone(phone)) return null;

  const base = {
    phone: phone.display,
    e164: phone.e164,
    source: 'google' as const,
    name: place.name,
    address: place.address,
    city: place.city,
    postalCode: place.postalCode,
    distanceKm: distanceTo(store, place.latitude, place.longitude),
    url: place.mapsUrl,
  };
  const scored = scoreCandidate(store, base);

  // Établissement fermé : le numéro ne vaut rien, même si tout le reste colle.
  if (place.businessStatus === 'CLOSED_PERMANENTLY') {
    scored.score -= 6;
    scored.reasons.push('définitivement fermé');
  } else if (place.businessStatus === 'CLOSED_TEMPORARILY') {
    scored.score -= 2;
    scored.reasons.push('temporairement fermé');
  }

  return { ...base, ...scored };
}

/** Dédoublonne par numéro en gardant la meilleure note, puis trie. */
function rank(candidates: PhoneCandidate[]): PhoneCandidate[] {
  const best = new Map<string, PhoneCandidate>();
  for (const c of candidates) {
    const existing = best.get(c.e164);
    if (!existing || c.score > existing.score) best.set(c.e164, c);
  }
  return Array.from(best.values()).sort((a, b) => b.score - a.score);
}

// ─── Recherche pour UN magasin ───────────────────────────────────────────────

/**
 * Cherche le numéro d'un magasin en cascade. N'écrit rien en base : la
 * persistance est décidée par l'appelant (cf. `applyLookupResult`).
 *
 * Peut lever GooglePlacesError si la clé Google est refusée : l'appelant doit
 * alors interrompre la campagne plutôt que d'enchaîner des appels perdus.
 */
export async function lookupStorePhone(
  store: StoreForLookup,
  options: LookupOptions = {},
): Promise<StoreLookupResult> {
  const label = storeLabel(store);
  const useGoogle = options.useGoogle ?? isGoogleConfigured();
  const brand = brandOf(store);

  if (!brand) {
    return { storeId: store.id, label, status: 'introuvable', phone: '', source: '', candidates: [] };
  }

  // Les coordonnées sont le meilleur garde-fou contre le mauvais magasin :
  // on géocode au passage les magasins qui ne l'ont jamais été.
  let located = store;
  if ((store.latitude == null || store.longitude == null) && options.geocode !== false) {
    const geo = await geocodeStore({
      address: store.address,
      postalCode: store.postalCode,
      city: store.city,
    });
    if (geo) located = { ...store, latitude: geo.latitude, longitude: geo.longitude };
  }

  const candidates: PhoneCandidate[] = [];

  // ── Étape 1 : OpenStreetMap (gratuit) ──────────────────────────────────────
  const dept = departmentCode(located);
  const pois =
    options.around && located.latitude != null && located.longitude != null
      ? await fetchBrandPoisAround(brand, located.latitude, located.longitude)
      : dept
        ? await fetchBrandPoisInDepartment(brand, dept, options.osmCache)
        : located.latitude != null && located.longitude != null
          ? await fetchBrandPoisAround(brand, located.latitude, located.longitude, 15000)
          : [];

  for (const poi of pois) {
    const candidate = osmToCandidate(located, poi);
    if (candidate) candidates.push(candidate);
  }

  let ranked = rank(candidates);

  // ── Étape 2 : Google Places (payant), seulement si OSM n'a pas tranché ─────
  const osmSettled = ranked.length > 0 && ranked[0].score >= AUTO_THRESHOLD;
  if (useGoogle && !osmSettled) {
    const bias =
      located.latitude != null && located.longitude != null
        ? { latitude: located.latitude, longitude: located.longitude, radiusMeters: 15000 }
        : undefined;
    const places = await searchPlaces(buildSearchQuery(located), bias);
    for (const place of places) {
      const candidate = googleToCandidate(located, place);
      if (candidate) candidates.push(candidate);
    }
    ranked = rank(candidates);
  }

  const kept = ranked.filter((c) => c.score >= REVIEW_THRESHOLD).slice(0, 3);
  const best = kept[0];

  if (!best) {
    return { storeId: store.id, label, status: 'introuvable', phone: '', source: '', candidates: [] };
  }
  if (best.score >= AUTO_THRESHOLD) {
    return {
      storeId: store.id, label, status: 'trouve',
      phone: best.phone, source: best.source, candidates: kept,
    };
  }
  return { storeId: store.id, label, status: 'a_verifier', phone: '', source: '', candidates: kept };
}

// ─── Persistance ─────────────────────────────────────────────────────────────

/**
 * Enregistre le résultat d'une recherche : le numéro sur le magasin, plus une
 * recopie sur l'affaire correspondante SI son champ « N° de téléphone » est
 * encore vide. Une saisie manuelle n'est jamais écrasée.
 */
export async function applyLookupResult(
  prisma: PrismaClient,
  result: StoreLookupResult,
  opts: { fillDeal?: boolean } = {},
): Promise<void> {
  await prisma.store.update({
    where: { id: result.storeId },
    data: {
      ...(result.phone ? { phone: result.phone, phoneSource: result.source || 'osm' } : {}),
      phoneLookupStatus: result.status,
      phoneLookupAt: new Date(),
      phoneCandidates: result.candidates.length ? (result.candidates as unknown as object) : undefined,
    },
  });

  if (result.phone && opts.fillDeal !== false) {
    await prisma.deal.updateMany({
      where: { storeId: result.storeId, contactPhone: '' },
      data: { contactPhone: result.phone },
    });
  }
}

// ─── Campagne (traitement de masse) ──────────────────────────────────────────

export type BatchScope = 'nouveaux' | 'echecs' | 'tout';

export interface BatchOptions {
  /** Nombre de magasins traités par appel (le lot suivant reprend la suite). */
  limit?: number;
  /** Périmètre : jamais cherchés / déjà déclarés introuvables / les deux. */
  scope?: BatchScope;
  useGoogle?: boolean;
  /** Ne traiter que les magasins rattachés à une affaire (par défaut : oui). */
  dealsOnly?: boolean;
}

export interface BatchReport {
  processed: number;
  found: number;
  toReview: number;
  notFound: number;
  errors: number;
  /** Magasins restant à traiter dans le périmètre après ce lot. */
  remaining: number;
  /** Détail du lot, pour l'affichage en direct. */
  results: StoreLookupResult[];
  /** Renseigné si la campagne s'est arrêtée d'elle-même (clé Google refusée…). */
  stopped?: string;
}

const STORE_SELECT = {
  id: true, name: true, city: true, postalCode: true, department: true,
  address: true, phone: true, latitude: true, longitude: true,
  brand: { select: { name: true } },
} as const;

/** Filtre Prisma correspondant au périmètre demandé. */
function whereForScope(scope: BatchScope, dealsOnly: boolean): Record<string, unknown> {
  const base: Record<string, unknown> = { phone: '' };
  if (dealsOnly) base.deal = { isNot: null };

  if (scope === 'nouveaux') base.phoneLookupStatus = '';
  // « echecs » : magasins déjà cherchés sans succès — à relancer typiquement
  // après avoir activé Google. La file de revue (« a_verifier ») est laissée de
  // côté : elle attend une décision humaine, pas une nouvelle recherche.
  else if (scope === 'echecs') base.phoneLookupStatus = { in: ['introuvable', 'erreur'] };
  else base.phoneLookupStatus = { not: 'a_verifier' };

  return base;
}

/**
 * Traite un lot de magasins. Volontairement borné (`limit`) pour rester dans les
 * temps d'exécution d'une route serveur : l'interface rappelle la route en
 * boucle jusqu'à ce que `remaining` tombe à zéro, ce qui rend la campagne
 * interruptible et reprenable à tout moment.
 *
 * Les magasins sont traités groupés par enseigne et département : c'est ce qui
 * permet à une seule requête OpenStreetMap de servir des dizaines de magasins.
 */
export async function runPhoneLookupBatch(
  prisma: PrismaClient,
  options: BatchOptions = {},
): Promise<BatchReport> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 500);
  const scope = options.scope ?? 'nouveaux';
  const dealsOnly = options.dealsOnly ?? true;
  const useGoogle = options.useGoogle ?? isGoogleConfigured();
  const where = whereForScope(scope, dealsOnly);

  const stores = (await prisma.store.findMany({
    where,
    select: STORE_SELECT,
    // Grouper par enseigne puis département maximise les réutilisations du
    // cache OSM à l'intérieur d'un même lot.
    orderBy: [{ brandId: 'asc' }, { department: 'asc' }, { postalCode: 'asc' }],
    take: limit,
  })) as StoreForLookup[];

  const report: BatchReport = {
    processed: 0, found: 0, toReview: 0, notFound: 0, errors: 0,
    remaining: 0, results: [],
  };

  const osmCache = createOsmCache();

  for (const store of stores) {
    let result: StoreLookupResult;
    try {
      result = await lookupStorePhone(store, { useGoogle, osmCache });
    } catch (err) {
      if (err instanceof GooglePlacesError) {
        // Clé refusée / quota épuisé : inutile de continuer, on rend la main
        // avec un message explicite plutôt que de marquer 2 000 magasins en erreur.
        report.stopped = `Google Places a refusé la requête (HTTP ${err.status}) : ${err.message}`;
        break;
      }
      result = {
        storeId: store.id, label: storeLabel(store), status: 'erreur',
        phone: '', source: '', candidates: [],
        error: err instanceof Error ? err.message : 'Erreur inconnue',
      };
    }

    await applyLookupResult(prisma, result);

    report.processed++;
    report.results.push(result);
    if (result.status === 'trouve') report.found++;
    else if (result.status === 'a_verifier') report.toReview++;
    else if (result.status === 'introuvable') report.notFound++;
    else report.errors++;
  }

  report.remaining = await prisma.store.count({ where });
  return report;
}

/** Compteurs affichés dans l'écran de campagne (Paramètres). */
export async function phoneLookupStats(prisma: PrismaClient, dealsOnly = true) {
  const scopeFilter = dealsOnly ? { deal: { isNot: null } } : {};
  const [total, withPhone, pending, toReview, notFound] = await Promise.all([
    prisma.store.count({ where: scopeFilter }),
    prisma.store.count({ where: { ...scopeFilter, phone: { not: '' } } }),
    prisma.store.count({ where: { ...scopeFilter, phone: '', phoneLookupStatus: '' } }),
    prisma.store.count({ where: { ...scopeFilter, phone: '', phoneLookupStatus: 'a_verifier' } }),
    prisma.store.count({ where: { ...scopeFilter, phone: '', phoneLookupStatus: { in: ['introuvable', 'erreur'] } } }),
  ]);
  return { total, withPhone, pending, toReview, notFound, googleConfigured: isGoogleConfigured() };
}
