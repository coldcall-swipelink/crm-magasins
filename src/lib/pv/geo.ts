// src/lib/pv/geo.ts
//
// Distances et géocodage pour le parcours boucher.
//
// Le magasin est géocodé UNE SEULE FOIS : les coordonnées obtenues auprès de
// l'API Adresse (api-adresse.data.gouv.fr, déjà utilisée par la carte du CRM)
// sont écrites sur le magasin. Les appels suivants les relisent en base — la
// page ne doit pas attendre un service extérieur pour s'afficher.

import { prisma } from '@/lib/prisma';
import { geocodeStore } from '@/lib/geocode';

const RAYON_TERRE_KM = 6371;

/** Distance à vol d'oiseau entre deux points, en kilomètres (haversine). */
export function distanceKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAYON_TERRE_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Écart de longitude couvrant `km` à la latitude donnée. Sert à borner les
 * requêtes SQL par une boîte englobante avant le calcul exact : sans elle, on
 * chargerait tous les magasins de France pour n'en garder que trois.
 */
export function lngDeltaForKm(km: number, atLat: number): number {
  const parDegre = 111.32 * Math.cos((atLat * Math.PI) / 180);
  // Près des pôles le cosinus s'annule ; en France il vaut ~0,65 à 0,75.
  return parDegre < 1 ? 180 : km / parDegre;
}

/** Écart de latitude couvrant `km` (constant : ~111 km par degré). */
export function latDeltaForKm(km: number): number {
  return km / 110.574;
}

export type StoreGeo = { latitude: number; longitude: number } | null;

/**
 * Coordonnées d'un magasin, géocodées à la demande puis mémorisées.
 *
 * Ne relance jamais un géocodage déjà tenté avec succès. En cas d'échec (adresse
 * introuvable, API indisponible), renvoie null sans écrire : la page se contente
 * alors de masquer ce qui dépend de la distance, et un prochain passage
 * réessaiera.
 */
export async function ensureStoreGeo(store: {
  id: string;
  latitude: number | null;
  longitude: number | null;
  address: string;
  postalCode: string;
  city: string;
  department: string;
}): Promise<StoreGeo> {
  if (store.latitude != null && store.longitude != null) {
    return { latitude: store.latitude, longitude: store.longitude };
  }

  const geo = await geocodeStore({
    address: store.address,
    postalCode: store.postalCode,
    city: store.city,
    department: store.department,
  });
  if (!geo) return null;

  await prisma.store.update({
    where: { id: store.id },
    data: {
      latitude: geo.latitude,
      longitude: geo.longitude,
      geocodedAt: new Date(),
      geocodeQuery: geo.usedQuery,
    },
  });
  return { latitude: geo.latitude, longitude: geo.longitude };
}
