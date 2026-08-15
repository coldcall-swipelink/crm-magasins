// src/lib/phone/osm.ts
// Source GRATUITE de numéros : OpenStreetMap, interrogé via l'API Overpass.
// Les magasins des grandes enseignes françaises y sont largement cartographiés
// et beaucoup portent une étiquette `phone` / `contact:phone`.
//
// Deux modes d'interrogation, pour ne pas maltraiter une API publique gratuite :
//
//   • PAR DÉPARTEMENT (traitement de masse) : UNE requête ramène tous les points
//     d'intérêt d'une enseigne dans un département. Un lot de 300 magasins
//     Carrefour du Nord ne coûte donc qu'UNE requête Overpass au lieu de 300.
//     Le résultat est mémorisé le temps du lot (cf. `pois-cache`).
//
//   • AUTOUR D'UN POINT (recherche à l'unité, depuis la fiche affaire) : requête
//     resserrée sur un rayon de quelques kilomètres, quasi instantanée.
//
// Aucune clé d'API n'est requise. Overpass demande en revanche un usage
// raisonnable : les requêtes sont sérialisées avec une pause entre chacune et
// une nouvelle tentative en cas de saturation (429 / 504).

import { normalizeText } from '@/lib/utils';

const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';
/** Pause minimale entre deux requêtes Overpass (usage courtois de l'API). */
const MIN_DELAY_MS = 1100;
const MAX_ATTEMPTS = 3;

/** Point d'intérêt OSM retenu comme candidat pour un magasin. */
export interface OsmPoi {
  osmId: string;
  name: string;
  brand: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
  city: string;
  postalCode: string;
  street: string;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function endpoint(): string {
  return process.env.OVERPASS_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
}

// ─── Sérialisation des appels ────────────────────────────────────────────────
// Toutes les requêtes Overpass du processus passent par cette file : jamais
// deux en parallèle, jamais moins de MIN_DELAY_MS entre deux départs.
let chain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastCallAt + MIN_DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    return task();
  });
  // La file ne doit jamais se rompre sur une erreur d'un maillon.
  chain = run.catch(() => undefined);
  return run;
}

/**
 * Exécute une requête Overpass QL. Renvoie un tableau vide (jamais d'exception)
 * si l'API est indisponible : une source gratuite qui tombe ne doit pas faire
 * échouer toute la campagne de recherche.
 */
async function overpass(query: string, timeoutMs: number): Promise<OverpassElement[]> {
  return enqueue(async () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(endpoint(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            // Overpass demande un User-Agent identifiant l'application.
            'User-Agent': 'crm-magasins/1.0 (recherche de numéros de magasins)',
          },
          body: new URLSearchParams({ data: query }).toString(),
          signal: AbortSignal.timeout(timeoutMs),
        });

        // 429 (trop de requêtes) et 504 (serveur saturé) sont les refus normaux
        // d'Overpass : on patiente puis on retente.
        if (res.status === 429 || res.status === 504) {
          if (attempt < MAX_ATTEMPTS) { await sleep(2000 * attempt); continue; }
          return [];
        }
        if (!res.ok) return [];

        const data = (await res.json()) as { elements?: OverpassElement[] };
        return data.elements ?? [];
      } catch {
        if (attempt < MAX_ATTEMPTS) { await sleep(1500 * attempt); continue; }
        return [];
      }
    }
    return [];
  });
}

/** Échappe une enseigne pour l'insérer dans une regex Overpass (POSIX ERE). */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Motif de recherche d'une enseigne dans les noms OSM. Encadré par des
 * non-lettres pour éviter les faux positifs sur les enseignes courtes : sans
 * cela, l'enseigne « U » remonterait tous les commerces contenant un « u ».
 */
function brandPattern(brand: string): string {
  const cleaned = normalizeText(brand).trim();
  if (!cleaned) return '';
  return `(^|[^a-zA-Z0-9])${escapeRegex(cleaned)}($|[^a-zA-Z0-9])`;
}

function toPoi(el: OverpassElement): OsmPoi | null {
  const tags = el.tags ?? {};
  const phone = tags.phone || tags['contact:phone'] || tags['contact:mobile'] || '';
  if (!phone) return null;

  const lat = el.lat ?? el.center?.lat ?? null;
  const lon = el.lon ?? el.center?.lon ?? null;

  return {
    osmId: `${el.type}/${el.id}`,
    name: tags.name || tags.brand || tags.operator || '',
    brand: tags.brand || tags.operator || '',
    phone,
    latitude: lat,
    longitude: lon,
    city: tags['addr:city'] || '',
    postalCode: tags['addr:postcode'] || '',
    street: [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
  };
}

// ─── Cache de lot ────────────────────────────────────────────────────────────
// Le résultat « enseigne × département » est mémorisé le temps du traitement :
// les magasins d'un même lot sont triés par enseigne puis département, si bien
// que 300 magasins consécutifs se servent tous dans la même réponse.
export type OsmCache = Map<string, OsmPoi[]>;

export function createOsmCache(): OsmCache {
  return new Map();
}

/**
 * Tous les points d'intérêt d'une enseigne dans un département, filtrés sur
 * ceux qui portent un numéro de téléphone.
 */
export async function fetchBrandPoisInDepartment(
  brand: string,
  department: string,
  cache?: OsmCache,
): Promise<OsmPoi[]> {
  const pattern = brandPattern(brand);
  if (!pattern || !department) return [];

  const key = `${normalizeText(brand)}|${department}`;
  const cached = cache?.get(key);
  if (cached) return cached;

  // `ref:INSEE` sur une frontière administrative de niveau 6 = département
  // français. Le nom et l'enseigne sont testés séparément : beaucoup de fiches
  // portent l'enseigne dans `brand`/`operator` et un nom local dans `name`.
  const query = `[out:json][timeout:120];
area["boundary"="administrative"]["admin_level"="6"]["ref:INSEE"="${department}"]->.dept;
(
  nwr["name"~"${pattern}",i](area.dept);
  nwr["brand"~"${pattern}",i](area.dept);
  nwr["operator"~"${pattern}",i](area.dept);
);
out tags center;`;

  const pois = (await overpass(query, 130_000)).map(toPoi).filter((p): p is OsmPoi => p !== null);
  cache?.set(key, pois);
  return pois;
}

/**
 * Points d'intérêt d'une enseigne dans un rayon donné autour d'un point.
 * Utilisé pour la recherche à l'unité déclenchée depuis la fiche affaire.
 */
export async function fetchBrandPoisAround(
  brand: string,
  latitude: number,
  longitude: number,
  radiusMeters = 4000,
): Promise<OsmPoi[]> {
  const pattern = brandPattern(brand);
  if (!pattern) return [];

  const around = `(around:${Math.round(radiusMeters)},${latitude},${longitude})`;
  const query = `[out:json][timeout:40];
(
  nwr["name"~"${pattern}",i]${around};
  nwr["brand"~"${pattern}",i]${around};
  nwr["operator"~"${pattern}",i]${around};
);
out tags center;`;

  return (await overpass(query, 45_000)).map(toPoi).filter((p): p is OsmPoi => p !== null);
}
