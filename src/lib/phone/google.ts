// src/lib/phone/google.ts
// Source PAYANTE de numéros : Google Places API (New), endpoint `searchText`.
// C'est exactement ce que fait la recherche manuelle « enseigne + nom du
// magasin » dans Google Maps, mais en un appel HTTP : la fiche Google renvoie
// directement le numéro de l'établissement.
//
// Cette source n'est utilisée qu'en SECOND, sur les magasins qu'OpenStreetMap
// n'a pas permis de résoudre : c'est la seule qui coûte de l'argent, autant ne
// la solliciter que sur le reliquat.
//
// Mise en place : Google Cloud Console → activer « Places API (New) » → créer
// une clé d'API → GOOGLE_PLACES_API_KEY. Sans clé, la source est simplement
// inactive et la recherche se limite aux sources gratuites.

const SEARCH_TEXT_URL = 'https://places.googleapis.com/v1/places:searchText';

// Champs demandés. Le masque de champs conditionne la facturation : on ne
// demande QUE ce qui sert à identifier le magasin et à récupérer son numéro.
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.location',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.googleMapsUri',
  'places.businessStatus',
].join(',');

/** Établissement Google retenu comme candidat pour un magasin. */
export interface GooglePlace {
  placeId: string;
  name: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  mapsUrl: string;
  /** « OPERATIONAL », « CLOSED_TEMPORARILY », « CLOSED_PERMANENTLY »… */
  businessStatus: string;
}

interface RawPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
  location?: { latitude?: number; longitude?: number };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  googleMapsUri?: string;
  businessStatus?: string;
}

/** La source est-elle configurée ? */
export function isGoogleConfigured(): boolean {
  return !!process.env.GOOGLE_PLACES_API_KEY?.trim();
}

function component(place: RawPlace, type: string): string {
  const c = place.addressComponents?.find((comp) => comp.types?.includes(type));
  return c?.longText || c?.shortText || '';
}

function toPlace(raw: RawPlace): GooglePlace | null {
  const phone = raw.nationalPhoneNumber || raw.internationalPhoneNumber || '';
  if (!phone) return null;

  return {
    placeId: raw.id || '',
    name: raw.displayName?.text || '',
    phone,
    address: raw.formattedAddress || '',
    city: component(raw, 'locality') || component(raw, 'postal_town'),
    postalCode: component(raw, 'postal_code'),
    latitude: raw.location?.latitude ?? null,
    longitude: raw.location?.longitude ?? null,
    mapsUrl: raw.googleMapsUri || '',
    businessStatus: raw.businessStatus || '',
  };
}

/** Erreur remontée par l'API Google (clé invalide, quota, facturation…). */
export class GooglePlacesError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GooglePlacesError';
    this.status = status;
  }
}

/**
 * Recherche textuelle d'un établissement, façon barre de recherche Google Maps.
 *
 * `bias` recentre la recherche autour des coordonnées du magasin quand elles
 * sont connues : sans ce recentrage, « Carrefour Market Saint-Denis » peut
 * renvoyer le magasin de La Réunion. Ce n'est qu'une préférence, pas un filtre :
 * la validation du bon magasin est faite ensuite par le scoring (cf. lookup.ts).
 *
 * Lève GooglePlacesError sur un refus de l'API (clé invalide, quota dépassé) :
 * ces erreurs concernent TOUTE la campagne, il faut l'arrêter plutôt que de
 * brûler des milliers d'appels voués à échouer.
 */
export async function searchPlaces(
  textQuery: string,
  bias?: { latitude: number; longitude: number; radiusMeters?: number },
  maxResults = 5,
): Promise<GooglePlace[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!apiKey || !textQuery.trim()) return [];

  const body: Record<string, unknown> = {
    textQuery: textQuery.trim(),
    languageCode: 'fr',
    regionCode: 'FR',
    maxResultCount: Math.min(Math.max(maxResults, 1), 20),
  };
  if (bias) {
    body.locationBias = {
      circle: {
        center: { latitude: bias.latitude, longitude: bias.longitude },
        radius: Math.min(bias.radiusMeters ?? 15000, 50000),
      },
    };
  }

  let res: Response;
  try {
    res = await fetch(SEARCH_TEXT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // Coupure réseau ponctuelle : le magasin sera retenté au prochain passage.
    return [];
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // 400/401/403 = configuration (clé, restrictions, API non activée),
    // 429 = quota. Dans tous ces cas, insister n'a aucun intérêt.
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 429) {
      throw new GooglePlacesError(res.status, detail.slice(0, 300) || `HTTP ${res.status}`);
    }
    return [];
  }

  const data = (await res.json().catch(() => ({}))) as { places?: RawPlace[] };
  return (data.places ?? []).map(toPlace).filter((p): p is GooglePlace => p !== null);
}
