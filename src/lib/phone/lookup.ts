// src/lib/phone/lookup.ts
// Cœur de la recherche automatique des numéros de magasins.
//
// PRINCIPE — une cascade, du gratuit vers le payant :
//
//   1. Le magasin a déjà un numéro         → on ne fait rien.
//   2. OpenStreetMap (gratuit, sans clé)   → tous les commerces porteurs d'un
//      numéro autour du magasin ; le rapprochement avec l'enseigne se fait ici,
//      en JavaScript, pas dans la requête (cf. osm.ts).
//   3. Google Places (payant, optionnel)   → uniquement le reliquat, c'est-à-dire
//      les magasins qu'OSM n'a pas permis de trancher.
//
// VALIDATION — le risque n'est pas de ne pas trouver de numéro, c'est d'en
// trouver un MAUVAIS (le Carrefour de la ville d'à côté, ou pire, la boulangerie
// voisine). Deux garde-fous successifs :
//
//   • un candidat dont le nom ne contient AUCUN mot de l'enseigne est écarté
//     d'emblée — c'est éliminatoire, pas un simple malus ;
//   • les survivants sont notés sur des indices vérifiables (enseigne complète,
//     code postal, ville, distance au magasin géocodé, adresse).
//
// Selon la note : note élevée → « trouve », le numéro est enregistré ; note
// moyenne → « a_verifier », un clic tranche dans l'interface ; rien →
// « introuvable ». Et si la SOURCE elle-même a échoué (Overpass injoignable,
// délai dépassé), le statut est « erreur » et non « introuvable » : un magasin
// que la source n'a jamais examiné doit rester à retenter.
//
// Rien n'est jamais écrasé : un numéro déjà saisi à la main reste intact.

import type { PrismaClient } from '@prisma/client';
import { normalizeText } from '@/lib/utils';
import { geocodeStore } from '@/lib/geocode';
import { distanceKm, departmentCode } from './geo';
import { normalizePhone, isProspectablePhone } from './normalize';
import { fetchPoisAround, fetchPoisInDepartment, type OsmFetchResult, type OsmPoi } from './osm';
import { isGoogleConfigured, searchPlaces, GooglePlacesError, type GooglePlace } from './google';

// ─── Seuils de décision ──────────────────────────────────────────────────────
/** Au-dessus : le numéro est enregistré sans intervention humaine. */
const AUTO_THRESHOLD = 6;
/** Au-dessus : le numéro est proposé dans la file de revue. */
const REVIEW_THRESHOLD = 3;
/**
 * Rayon d'interrogation d'OpenStreetMap autour du magasin. Généreux à dessein :
 * en zone rurale, le magasin géocodé et sa fiche OSM peuvent être distants de
 * plusieurs kilomètres, et le géocodage peut n'avoir résolu que la commune.
 */
const DEFAULT_RADIUS_M = 5000;
/**
 * Portée du bonus d'unicité : au-delà, « le seul magasin de l'enseigne dans le
 * rayon » ne dit plus grand-chose du magasin qu'on cherche.
 */
const UNIQUE_BONUS_MAX_KM = 5;

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
  /** L'enseigne du magasin est-elle entièrement ou partiellement reconnue ? */
  brandMatch: 'complet' | 'partiel';
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

/** Trace d'exécution, pour comprendre un résultat décevant sans deviner. */
export interface LookupDiagnostics {
  department: string;
  latitude: number | null;
  longitude: number | null;
  /** Le magasin a-t-il été géocodé au cours de cette recherche ? */
  geocodedNow: boolean;
  osm: {
    strategy: 'autour' | 'departement' | 'aucune';
    ok: boolean;
    status: number;
    error: string;
    elapsedMs: number;
    /** Objets renvoyés par Overpass (tous types confondus). */
    elementCount: number;
    /** Objets porteurs d'un numéro et d'un nom. */
    poiCount: number;
    /** Objets dont le nom évoque l'enseigne du magasin. */
    brandMatchCount: number;
    query: string;
  };
  google: {
    used: boolean;
    configured: boolean;
    query: string;
    resultCount: number;
  };
  /** Tous les candidats notés, y compris ceux sous le seuil (10 au maximum). */
  scored: PhoneCandidate[];
}

export interface StoreLookupResult {
  storeId: string;
  /** Libellé lisible du magasin, pour les journaux et la file de revue. */
  label: string;
  status: PhoneLookupStatus;
  /** Numéro retenu (vide si « a_verifier », « introuvable » ou « erreur »). */
  phone: string;
  source: PhoneSource | '';
  /** Meilleurs candidats, triés par note décroissante (3 au maximum). */
  candidates: PhoneCandidate[];
  /** Message d'erreur éventuel (statut « erreur »). */
  error?: string;
  /** Renseigné uniquement en mode diagnostic. */
  diagnostics?: LookupDiagnostics;
}

export interface LookupOptions {
  /** Interroger Google Places pour le reliquat (par défaut : si une clé existe). */
  useGoogle?: boolean;
  /**
   * Géocoder le magasin s'il ne l'est pas encore. Les coordonnées améliorent
   * beaucoup la validation (distance) : activé par défaut.
   */
  geocode?: boolean;
  /** Rayon d'interrogation d'OpenStreetMap, en mètres. */
  radiusMeters?: number;
  /** Conserver la trace d'exécution complète (écran de diagnostic). */
  withDiagnostics?: boolean;
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

// ─── Rapprochement d'enseigne ────────────────────────────────────────────────

/** Mots d'un libellé, normalisés (accents et ponctuation supprimés). */
function words(value: string): string[] {
  return normalizeText(value).split(' ').filter(Boolean);
}

/**
 * L'établissement candidat porte-t-il l'enseigne du magasin ?
 *
 * La comparaison se fait MOT À MOT sur des libellés normalisés des deux côtés :
 * c'est ce qui permet à « Intermarché » de retrouver « Intermarché Contact » et
 * à « E.Leclerc » de retrouver « E.Leclerc Drive ». Comparer des mots entiers
 * (et non des sous-chaînes) évite au passage que l'enseigne « U » ne se
 * reconnaisse dans n'importe quel commerce contenant un « u ».
 *
 *   « complet » : tous les mots de l'enseigne sont présents ;
 *   « partiel » : au moins un mot significatif l'est ;
 *   « aucun »   : éliminatoire.
 */
function brandMatch(store: StoreForLookup, candidateText: string): 'complet' | 'partiel' | 'aucun' {
  const brandWords = words(brandOf(store));
  if (brandWords.length === 0) return 'aucun';

  const candidateWords = new Set(words(candidateText));
  const present = brandWords.filter((w) => candidateWords.has(w));
  if (present.length === brandWords.length) return 'complet';

  // Un mot d'une seule lettre (« U », « E ») ne suffit pas à lui seul : sans
  // cette précaution, « E.Leclerc » se reconnaîtrait dans n'importe quel nom
  // contenant un « e » isolé.
  if (present.some((w) => w.length > 1)) return 'partiel';
  return 'aucun';
}

// ─── Notation des candidats ──────────────────────────────────────────────────

/**
 * Note un candidat face au magasin visé. La note additionne des indices
 * indépendants ; aucun ne suffit seul à valider automatiquement, c'est leur
 * convergence (bonne enseigne + bon code postal + bonne ville / bonne distance)
 * qui autorise un enregistrement sans relecture.
 */
function scoreCandidate(
  store: StoreForLookup,
  candidate: Omit<PhoneCandidate, 'score' | 'reasons'>,
  match: 'complet' | 'partiel',
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // 1. Enseigne (les candidats sans aucune correspondance sont déjà écartés).
  if (match === 'complet') { score += 3; reasons.push('enseigne reconnue'); }
  else { score += 1; reasons.push('enseigne partiellement reconnue'); }

  // 2. Code postal — l'indice le plus discriminant en zone dense.
  const cpStore = (store.postalCode || '').replace(/\D/g, '');
  const cpCandidate = (candidate.postalCode || '').replace(/\D/g, '');
  if (cpStore && cpCandidate) {
    if (cpStore === cpCandidate) { score += 3; reasons.push('code postal identique'); }
    else { score -= 2; reasons.push(`code postal différent (${cpCandidate})`); }
  }

  // 3. Ville.
  const cityStore = normalizeText(store.city);
  const cityCandidate = normalizeText(candidate.city);
  if (cityStore && cityCandidate) {
    if (cityStore === cityCandidate) { score += 2; reasons.push('ville identique'); }
    else if (cityCandidate.includes(cityStore) || cityStore.includes(cityCandidate)) {
      score += 1; reasons.push('ville proche');
    } else { score -= 1; reasons.push(`ville différente (${candidate.city})`); }
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
  const brandWords = words(brandOf(store));
  const candidateWords = new Set(words(candidate.name));
  const nameWords = words(store.name).filter(
    (w) => w.length > 2 && !brandWords.includes(w) && w !== cityStore,
  );
  if (nameWords.length > 0 && nameWords.some((w) => candidateWords.has(w))) {
    score += 2;
    reasons.push('nom du magasin retrouvé');
  }

  // 6. Adresse (numéro + rue) commune.
  const streetWords = words(store.address).filter((w) => w.length > 3);
  const addressWords = new Set(words(candidate.address));
  if (streetWords.length >= 2 && streetWords.filter((w) => addressWords.has(w)).length >= 2) {
    score += 2;
    reasons.push('adresse concordante');
  }

  // Une enseigne seulement PARTIELLEMENT reconnue ne peut jamais suffire à
  // valider toute seule, quels que soient les autres indices : « Super U » se
  // reconnaît dans « Intermarché SUPER », et ces collisions de mots communs
  // (Super, Market, Contact, Express, Drive) sont fréquentes entre enseignes.
  // On plafonne donc sous le seuil : le candidat part en vérification humaine.
  if (match === 'partiel' && score >= AUTO_THRESHOLD) {
    score = AUTO_THRESHOLD - 1;
    reasons.push('enseigne incomplète → vérification requise');
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
  // Le nom ET l'étiquette d'enseigne sont examinés : beaucoup de fiches portent
  // un nom local et l'enseigne uniquement dans `brand` / `operator`.
  const match = brandMatch(store, `${poi.name} ${poi.brand}`);
  if (match === 'aucun') return null;

  const phone = normalizePhone(poi.phone);
  if (!phone || !isProspectablePhone(phone)) return null;

  const base = {
    phone: phone.display,
    e164: phone.e164,
    source: 'osm' as const,
    name: poi.name,
    address: [poi.street, poi.postalCode, poi.city].filter(Boolean).join(' '),
    city: poi.city,
    postalCode: poi.postalCode,
    distanceKm: distanceTo(store, poi.latitude, poi.longitude),
    brandMatch: match,
    url: `https://www.openstreetmap.org/${poi.osmId}`,
  };
  return { ...base, ...scoreCandidate(store, base, match) };
}

function googleToCandidate(store: StoreForLookup, place: GooglePlace): PhoneCandidate | null {
  const match = brandMatch(store, place.name);
  if (match === 'aucun') return null;

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
    brandMatch: match,
    url: place.mapsUrl,
  };
  const scored = scoreCandidate(store, base, match);

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

/**
 * Bonus d'UNICITÉ : quand un seul établissement porte pleinement l'enseigne
 * dans le rayon, la correspondance est bien plus sûre que la somme des indices
 * ne le laisse croire.
 *
 * C'est décisif sur les fiches pauvres. Beaucoup de magasins n'ont ni adresse
 * ni code postal en base, et beaucoup de points OSM n'ont pas d'étiquette de
 * ville : il ne reste alors que l'enseigne et la distance, jamais assez pour
 * valider. Or « le seul Super U à moins de 5 km d'un magasin Super U » n'a rien
 * d'ambigu. Dès qu'il y en a deux, plus de bonus : l'ambiguïté est réelle et la
 * décision revient à un humain.
 */
function applyUniquenessBonus(candidates: PhoneCandidate[]): PhoneCandidate[] {
  const fullMatches = candidates.filter(
    (c) => c.brandMatch === 'complet' && (c.distanceKm === null || c.distanceKm <= UNIQUE_BONUS_MAX_KM),
  );
  if (fullMatches.length !== 1) return candidates;

  // Volontairement SANS effet de bord : `rank` est appelé plusieurs fois sur le
  // même tableau de candidats (une fois après OpenStreetMap, une fois après
  // Google), et muter les objets appliquerait le bonus deux fois.
  const unique = fullMatches[0];
  return candidates.map((c) =>
    c === unique
      ? { ...c, score: c.score + 2, reasons: [...c.reasons, 'seul magasin de l\'enseigne dans le rayon'] }
      : c,
  );
}

/** Dédoublonne par numéro en gardant la meilleure note, puis trie. */
function rank(candidates: PhoneCandidate[]): PhoneCandidate[] {
  const best = new Map<string, PhoneCandidate>();
  for (const c of candidates) {
    const existing = best.get(c.e164);
    if (!existing || c.score > existing.score) best.set(c.e164, c);
  }
  // Le bonus d'unicité se calcule APRÈS dédoublonnage : deux fiches OSM du même
  // magasin (le bâtiment et son point de vente) portant le même numéro ne
  // doivent pas se faire passer pour deux magasins concurrents.
  const deduped = applyUniquenessBonus(Array.from(best.values()));
  return deduped.sort((a, b) => b.score - a.score);
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

  // Les coordonnées sont le meilleur garde-fou contre le mauvais magasin, et
  // conditionnent la stratégie d'interrogation d'OSM : on géocode donc au
  // passage les magasins qui ne l'ont jamais été.
  let located = store;
  let geocodedNow = false;
  if ((store.latitude == null || store.longitude == null) && options.geocode !== false) {
    const geo = await geocodeStore({
      address: store.address,
      postalCode: store.postalCode,
      city: store.city,
    });
    if (geo) {
      located = { ...store, latitude: geo.latitude, longitude: geo.longitude };
      geocodedNow = true;
    }
  }

  // ── Étape 1 : OpenStreetMap (gratuit) ──────────────────────────────────────
  const dept = departmentCode(located);
  let strategy: LookupDiagnostics['osm']['strategy'] = 'aucune';
  let osm: OsmFetchResult = { pois: [], ok: true, status: 0, error: '', elapsedMs: 0, query: '', elementCount: 0 };

  if (located.latitude != null && located.longitude != null) {
    strategy = 'autour';
    osm = await fetchPoisAround(located.latitude, located.longitude, options.radiusMeters ?? DEFAULT_RADIUS_M);
  } else if (dept) {
    // Magasin non localisable : repli sur tout le département.
    strategy = 'departement';
    osm = await fetchPoisInDepartment(dept);
  }

  const candidates: PhoneCandidate[] = [];
  let brandMatchCount = 0;
  for (const poi of osm.pois) {
    const candidate = osmToCandidate(located, poi);
    if (candidate) { candidates.push(candidate); brandMatchCount++; }
  }

  let ranked = rank(candidates);

  // ── Étape 2 : Google Places (payant), seulement si OSM n'a pas tranché ─────
  const osmSettled = ranked.length > 0 && ranked[0].score >= AUTO_THRESHOLD;
  const googleQuery = buildSearchQuery(located);
  let googleUsed = false;
  let googleResultCount = 0;

  if (useGoogle && !osmSettled) {
    googleUsed = true;
    const bias =
      located.latitude != null && located.longitude != null
        ? { latitude: located.latitude, longitude: located.longitude, radiusMeters: 15000 }
        : undefined;
    const places = await searchPlaces(googleQuery, bias);
    googleResultCount = places.length;
    for (const place of places) {
      const candidate = googleToCandidate(located, place);
      if (candidate) candidates.push(candidate);
    }
    ranked = rank(candidates);
  }

  const diagnostics: LookupDiagnostics | undefined = options.withDiagnostics
    ? {
        department: dept,
        latitude: located.latitude,
        longitude: located.longitude,
        geocodedNow,
        osm: {
          strategy, ok: osm.ok, status: osm.status, error: osm.error,
          elapsedMs: osm.elapsedMs, elementCount: osm.elementCount,
          poiCount: osm.pois.length, brandMatchCount, query: osm.query,
        },
        google: { used: googleUsed, configured: isGoogleConfigured(), query: googleQuery, resultCount: googleResultCount },
        scored: ranked.slice(0, 10),
      }
    : undefined;

  const kept = ranked.filter((c) => c.score >= REVIEW_THRESHOLD).slice(0, 3);
  const best = kept[0];

  if (best && best.score >= AUTO_THRESHOLD) {
    return {
      storeId: store.id, label, status: 'trouve',
      phone: best.phone, source: best.source, candidates: kept, diagnostics,
    };
  }
  if (best) {
    return { storeId: store.id, label, status: 'a_verifier', phone: '', source: '', candidates: kept, diagnostics };
  }

  // Rien trouvé — mais était-ce faute de données, ou faute de réponse ? Un
  // magasin que la source n'a jamais pu examiner reste « en erreur », donc
  // à retenter, plutôt que d'être classé « introuvable » à tort.
  if (!osm.ok) {
    return {
      storeId: store.id, label, status: 'erreur', phone: '', source: '', candidates: [],
      error: `OpenStreetMap injoignable : ${osm.error}`, diagnostics,
    };
  }
  if (strategy === 'aucune') {
    return {
      storeId: store.id, label, status: 'erreur', phone: '', source: '', candidates: [],
      error: 'Magasin ni géocodable ni rattaché à un département (adresse trop incomplète)',
      diagnostics,
    };
  }
  return { storeId: store.id, label, status: 'introuvable', phone: '', source: '', candidates: [], diagnostics };
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
  /** Plafond de magasins traités par appel (le lot suivant reprend la suite). */
  limit?: number;
  /**
   * Budget de temps du lot, en millisecondes. Le lot s'arrête dès qu'il est
   * dépassé, sans entamer un magasin de plus.
   */
  maxMillis?: number;
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

/**
 * Plafond de magasins par lot. C'est une borne haute, pas un objectif : le
 * budget de temps ci-dessous s'atteint presque toujours en premier.
 */
const DEFAULT_BATCH = 25;

/**
 * Budget de temps d'un lot. C'est LE garde-fou de la campagne.
 *
 * Une interrogation d'OpenStreetMap ne coûte presque rien en données, mais
 * s'exécute sur une instance publique partagée : mesurée à ~37 s en conditions
 * réelles, contre 2 à 3 s quand l'instance est disponible. Dimensionner un lot
 * en NOMBRE de magasins revient donc à parier sur cette latence, et un mauvais
 * pari dépasse le temps d'exécution maximal de la fonction — la requête est
 * tuée et l'utilisateur voit une erreur.
 *
 * On raisonne donc en temps : le lot traite autant de magasins qu'il peut en
 * 40 secondes, puis rend la main quel qu'en soit le nombre. La campagne avance
 * au rythme réel de la source, sans jamais heurter la limite de la plateforme.
 */
const DEFAULT_BATCH_MILLIS = 40_000;

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
  // après une panne de source ou après avoir activé Google. La file de revue
  // (« a_verifier ») est laissée de côté : elle attend une décision humaine,
  // pas une nouvelle recherche.
  else if (scope === 'echecs') base.phoneLookupStatus = { in: ['introuvable', 'erreur'] };
  else base.phoneLookupStatus = { not: 'a_verifier' };

  return base;
}

/**
 * Traite un lot de magasins. Volontairement borné (`limit`) pour rester dans les
 * temps d'exécution d'une route serveur : l'interface rappelle la route en
 * boucle jusqu'à ce que `remaining` tombe à zéro, ce qui rend la campagne
 * interruptible et reprenable à tout moment.
 */
export async function runPhoneLookupBatch(
  prisma: PrismaClient,
  options: BatchOptions = {},
): Promise<BatchReport> {
  const startedAt = Date.now();
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_BATCH, 1), 500);
  const budgetMs = Math.max(options.maxMillis ?? DEFAULT_BATCH_MILLIS, 1000);
  const scope = options.scope ?? 'nouveaux';
  const dealsOnly = options.dealsOnly ?? true;
  const useGoogle = options.useGoogle ?? isGoogleConfigured();
  const where = whereForScope(scope, dealsOnly);

  const stores = (await prisma.store.findMany({
    where,
    select: STORE_SELECT,
    // Traiter les magasins voisins à la suite améliore les chances qu'Overpass
    // serve des réponses déjà en cache côté serveur.
    orderBy: [{ department: 'asc' }, { postalCode: 'asc' }],
    take: limit,
  })) as StoreForLookup[];

  const report: BatchReport = {
    processed: 0, found: 0, toReview: 0, notFound: 0, errors: 0,
    remaining: 0, results: [],
  };

  /** Durée de chaque magasin traité, pour anticiper le coût du suivant. */
  const durations: number[] = [];

  for (const store of stores) {
    // On n'entame un magasin que si on peut vraisemblablement le TERMINER dans
    // le budget : vérifier le temps déjà écoulé ne suffirait pas, un magasin
    // pouvant coûter à lui seul plus que le budget restant. Le premier magasin
    // part toujours, sinon un lot pourrait ne rien faire et la campagne
    // n'avancerait jamais.
    if (durations.length > 0) {
      const average = durations.reduce((a, b) => a + b, 0) / durations.length;
      if (Date.now() - startedAt + average > budgetMs) break;
    }

    const storeStartedAt = Date.now();
    let result: StoreLookupResult;
    try {
      result = await lookupStorePhone(store, { useGoogle });
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
    durations.push(Date.now() - storeStartedAt);

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
  const [total, withPhone, pending, toReview, notFound, errors] = await Promise.all([
    prisma.store.count({ where: scopeFilter }),
    prisma.store.count({ where: { ...scopeFilter, phone: { not: '' } } }),
    prisma.store.count({ where: { ...scopeFilter, phone: '', phoneLookupStatus: '' } }),
    prisma.store.count({ where: { ...scopeFilter, phone: '', phoneLookupStatus: 'a_verifier' } }),
    prisma.store.count({ where: { ...scopeFilter, phone: '', phoneLookupStatus: 'introuvable' } }),
    prisma.store.count({ where: { ...scopeFilter, phone: '', phoneLookupStatus: 'erreur' } }),
  ]);
  return { total, withPhone, pending, toReview, notFound, errors, googleConfigured: isGoogleConfigured() };
}
