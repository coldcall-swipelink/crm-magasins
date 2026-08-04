// src/lib/geocode.ts
// Géocodage d'adresses françaises via la Base Adresse Nationale (BAN),
// API publique et gratuite de data.gouv.fr (aucune clé requise).
// Doc : https://adresse.data.gouv.fr/api-doc/adresse

const BAN_ENDPOINT = 'https://api-adresse.data.gouv.fr/search/';

export interface GeoInput {
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  department?: string | null;
}

export interface GeoResult {
  latitude: number;
  longitude: number;
}

/**
 * Construit la requête texte envoyée à la BAN à partir des champs d'adresse
 * d'un magasin. Renvoie une chaîne vide si rien d'exploitable.
 */
export function buildGeocodeQuery(input: GeoInput): string {
  return [input.address, input.postalCode, input.city]
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Géocode un magasin de façon robuste, avec repli progressif : on tente
 * d'abord l'adresse complète (adresse + code postal + ville), puis, si elle
 * échoue, code postal + ville, puis la ville seule. Ainsi un magasin dont
 * l'adresse est bancale (nom d'enseigne, « C.C. », lieu-dit, code postal faux)
 * mais dont la ville est correcte finit tout de même localisé.
 *
 * Renvoie les coordonnées et la requête qui a fonctionné, ou null si aucune
 * variante n'aboutit.
 */
export async function geocodeStore(
  input: GeoInput,
): Promise<(GeoResult & { usedQuery: string }) | null> {
  const candidates = [
    buildGeocodeQuery(input),
    buildGeocodeQuery({ postalCode: input.postalCode, city: input.city }),
    buildGeocodeQuery({ city: input.city }),
  ];
  const seen = new Set<string>();
  for (const query of candidates) {
    if (!query || seen.has(query)) continue;
    seen.add(query);
    const result = await geocodeQuery(query);
    if (result) return { ...result, usedQuery: query };
  }
  return null;
}

/**
 * Géocode une requête texte. Renvoie null si l'adresse est introuvable ou en
 * cas d'erreur réseau (la carte gère gracieusement les magasins non localisés).
 */
export async function geocodeQuery(query: string): Promise<GeoResult | null> {
  const q = query.trim();
  if (!q) return null;

  const url = new URL(BAN_ENDPOINT);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '1');

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      // Évite de bloquer indéfiniment si la BAN est lente.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      features?: Array<{ geometry?: { coordinates?: [number, number] } }>;
    };
    const coords = data.features?.[0]?.geometry?.coordinates;
    if (!coords || coords.length < 2) return null;

    const [longitude, latitude] = coords;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    return { latitude, longitude };
  } catch {
    return null;
  }
}
