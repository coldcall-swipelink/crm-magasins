// src/lib/phone/osm.ts
// Source GRATUITE de numéros : OpenStreetMap, interrogé via l'API Overpass.
// Les magasins des grandes enseignes françaises y sont largement cartographiés
// et beaucoup portent une étiquette `phone` / `contact:phone`.
//
// STRATÉGIE — on ne demande PAS à Overpass de filtrer par enseigne.
//
// Une première version envoyait le nom de l'enseigne dans la requête, sous
// forme d'expression régulière. C'était une fausse bonne idée : le terme
// cherché était normalisé (sans accents ni ponctuation) alors qu'Overpass le
// comparait au nom BRUT d'OpenStreetMap. « Intermarché » cherché en
// « intermarche » ne trouvait rien, « E.Leclerc » cherché en « e leclerc » non
// plus — seules les enseignes sans accent ni ponctuation fonctionnaient.
//
// On demande donc simplement TOUS les points d'intérêt nommés qui portent un
// numéro de téléphone autour du magasin, et le rapprochement enseigne par
// enseigne se fait ensuite en JavaScript, où les deux côtés passent par la même
// normalisation (cf. lookup.ts). C'est à la fois plus robuste et plus léger :
// le filtre « a un téléphone » élimine l'essentiel du volume côté serveur.
//
// Deux modes d'interrogation :
//
//   • AUTOUR DU MAGASIN (mode normal) : rayon de quelques kilomètres, réponse
//     petite et rapide. C'est le mode par défaut, y compris en traitement de
//     masse : il tient dans les temps d'exécution d'une fonction serverless.
//
//   • PAR DÉPARTEMENT (repli) : uniquement pour les magasins qu'on n'a pas pu
//     géocoder, donc sans point de référence. Requête lourde, mise en cache et
//     partagée par toutes les enseignes du département.
//
// Aucune clé d'API n'est requise. Overpass demande en revanche un usage
// raisonnable : les requêtes sont sérialisées avec une pause entre chacune et
// une nouvelle tentative en cas de saturation (429 / 504).

const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';
/** Pause minimale entre deux requêtes Overpass (usage courtois de l'API). */
const MIN_DELAY_MS = 1100;
const MAX_ATTEMPTS = 3;
/**
 * Au-delà de ce temps déjà passé sur une requête, on ne retente plus.
 *
 * L'instance publique d'Overpass peut mettre plusieurs dizaines de secondes à
 * répondre. Sans ce plafond, trois tentatives à 45 s cumuleraient plus de deux
 * minutes et feraient tuer la fonction serverless par la plateforme — un échec
 * bien pire que celui qu'on essayait de rattraper.
 */
const RETRY_DEADLINE_MS = 20_000;

/** Point d'intérêt OSM porteur d'un numéro de téléphone. */
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

/**
 * Résultat d'une interrogation Overpass. L'issue est TOUJOURS explicite : une
 * panne ne doit jamais ressembler à « aucun magasin trouvé », sous peine de
 * marquer définitivement « introuvables » des milliers de magasins que la
 * source n'a en réalité jamais eu l'occasion d'examiner.
 */
export interface OsmFetchResult {
  pois: OsmPoi[];
  ok: boolean;
  /** Code HTTP de la dernière tentative. 0 = pas de réponse (réseau, délai). */
  status: number;
  error: string;
  elapsedMs: number;
  /** Instance Overpass réellement interrogée (diagnostic). */
  endpoint: string;
  /** Requête Overpass QL envoyée (diagnostic). */
  query: string;
  /** Nombre d'objets renvoyés, avant filtrage sur la présence d'un numéro. */
  elementCount: number;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Instances Overpass publiques autorisées. La liste blanche existe parce que
 * l'instance est surchargeable depuis l'écran de diagnostic (paramètre d'URL) :
 * sans elle, n'importe qui pourrait faire émettre au serveur une requête vers
 * l'hôte de son choix.
 */
const ALLOWED_HOSTS = [
  'overpass-api.de',
  'overpass.kumi.systems',
  'overpass.osm.ch',
  'overpass.private.coffee',
  'overpass.osm.jp',
];

/** L'URL désigne-t-elle une instance Overpass publique connue ? */
export function isAllowedEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

function endpoint(override?: string): string {
  if (override && isAllowedEndpoint(override)) return override;
  const configured = process.env.OVERPASS_ENDPOINT?.trim();
  if (configured && isAllowedEndpoint(configured)) return configured;
  return DEFAULT_ENDPOINT;
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

/** Exécute une requête Overpass QL en rapportant précisément son issue. */
async function overpass(query: string, timeoutMs: number, override?: string): Promise<OsmFetchResult> {
  const url = endpoint(override);
  return enqueue(async () => {
    const startedAt = Date.now();
    const fail = (status: number, error: string): OsmFetchResult => ({
      pois: [], ok: false, status, error,
      elapsedMs: Date.now() - startedAt, endpoint: url, query, elementCount: 0,
    });

    let lastStatus = 0;
    let lastError = 'Aucune tentative aboutie';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            // Overpass demande un User-Agent identifiant l'application.
            'User-Agent': 'crm-magasins/1.0 (recherche de numéros de magasins)',
          },
          body: new URLSearchParams({ data: query }).toString(),
          signal: AbortSignal.timeout(timeoutMs),
        });
        lastStatus = res.status;

        // 429 (trop de requêtes) et 504 (serveur saturé) sont les refus normaux
        // d'Overpass : on patiente puis on retente.
        if (res.status === 429 || res.status === 504) {
          lastError = `Overpass saturé (HTTP ${res.status})`;
          if (attempt < MAX_ATTEMPTS && Date.now() - startedAt < RETRY_DEADLINE_MS) {
            await sleep(2000 * attempt);
            continue;
          }
          return fail(lastStatus, lastError);
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          return fail(res.status, `HTTP ${res.status} ${body.slice(0, 200)}`.trim());
        }

        const data = (await res.json()) as { elements?: OverpassElement[] };
        const elements = data.elements ?? [];
        const pois = elements.map(toPoi).filter((p): p is OsmPoi => p !== null);
        return {
          pois, ok: true, status: res.status, error: '',
          elapsedMs: Date.now() - startedAt, endpoint: url, query,
          elementCount: elements.length,
        };
      } catch (err) {
        lastError = err instanceof Error ? `${err.name}: ${err.message}` : 'Erreur réseau';
        if (attempt < MAX_ATTEMPTS && Date.now() - startedAt < RETRY_DEADLINE_MS) {
          await sleep(1500 * attempt);
          continue;
        }
        return fail(lastStatus, lastError);
      }
    }
    return fail(lastStatus, lastError);
  });
}

function toPoi(el: OverpassElement): OsmPoi | null {
  const tags = el.tags ?? {};
  const phone = tags.phone || tags['contact:phone'] || tags['contact:mobile'] || '';
  if (!phone) return null;

  // Sans nom ni enseigne, impossible de rattacher le point à un magasin.
  const name = tags.name || tags.brand || tags.operator || '';
  if (!name) return null;

  return {
    osmId: `${el.type}/${el.id}`,
    name,
    brand: tags.brand || tags.operator || '',
    phone,
    latitude: el.lat ?? el.center?.lat ?? null,
    longitude: el.lon ?? el.center?.lon ?? null,
    city: tags['addr:city'] || '',
    postalCode: tags['addr:postcode'] || '',
    street: [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
  };
}

/**
 * Tous les points d'intérêt nommés porteurs d'un numéro dans un rayon donné.
 * Mode par défaut : réponse de l'ordre de quelques dizaines à quelques centaines
 * d'objets, obtenue en quelques secondes.
 */
export async function fetchPoisAround(
  latitude: number,
  longitude: number,
  radiusMeters = 3000,
  endpointOverride?: string,
): Promise<OsmFetchResult> {
  const around = `(around:${Math.round(radiusMeters)},${latitude},${longitude})`;
  const query = `[out:json][timeout:40];
(
  nwr["phone"]["name"]${around};
  nwr["contact:phone"]["name"]${around};
);
out tags center;`;

  return overpass(query, 45_000, endpointOverride);
}

// ─── Repli par département ───────────────────────────────────────────────────
// Réservé aux magasins non géocodés. La réponse étant volumineuse, elle est
// mise en cache au niveau du module : elle survit ainsi d'un lot à l'autre tant
// que l'instance reste chaude, et sert TOUTES les enseignes du département
// (la requête ne filtre plus par enseigne).

interface CacheEntry { at: number; result: OsmFetchResult }
const DEPT_CACHE_TTL_MS = 30 * 60 * 1000;
/** Peu d'entrées : une réponse départementale pèse lourd en mémoire. */
const DEPT_CACHE_MAX = 2;
const deptCache = new Map<string, CacheEntry>();

export async function fetchPoisInDepartment(department: string): Promise<OsmFetchResult> {
  if (!department) {
    return { pois: [], ok: false, status: 0, error: 'Département inconnu', elapsedMs: 0, endpoint: '', query: '', elementCount: 0 };
  }

  const cached = deptCache.get(department);
  if (cached && Date.now() - cached.at < DEPT_CACHE_TTL_MS) return cached.result;

  // `ref:INSEE` sur une frontière administrative de niveau 6 = département
  // français.
  const query = `[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="6"]["ref:INSEE"="${department}"]->.dept;
(
  nwr["phone"]["name"](area.dept);
  nwr["contact:phone"]["name"](area.dept);
);
out tags center;`;

  const result = await overpass(query, 185_000);

  // Un échec n'est pas mis en cache : il doit pouvoir être retenté.
  if (result.ok) {
    if (deptCache.size >= DEPT_CACHE_MAX) {
      const oldest = deptCache.keys().next();
      if (!oldest.done) deptCache.delete(oldest.value);
    }
    deptCache.set(department, { at: Date.now(), result });
  }
  return result;
}
