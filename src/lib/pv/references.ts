// src/lib/pv/references.ts
//
// « Déjà avec Swipelink dans votre région » : les trois magasins voisins cités
// sur la page (et dans le mail).
//
// Quatre conditions, toutes obligatoires :
//
//   1. CLIENT ACTUEL — au moins un abonnement closé, non résilié, et pas encore
//      arrivé à échéance. Un ancien client n'est pas une référence.
//   2. MÊME ENSEIGNE — un directeur de Leclerc se compare à des Leclerc.
//   3. À MOINS DE 100 km — « dans votre région » doit être vrai.
//   4. A ACCEPTÉ D'ÊTRE CITÉ — la case `citableReference` de la fiche affaire.
//      Sans elle, jamais : citer un client qui ne l'a pas voulu, c'est perdre
//      deux clients d'un coup.
//
// Aucune référence ne remonte ? La page masque le bloc et le mail aussi. Mieux
// vaut pas de preuve sociale qu'une preuve sociale creuse.

import { prisma } from '@/lib/prisma';
import { brandSlug } from '@/lib/pv/brands';
import { distanceKm, latDeltaForKm, lngDeltaForKm } from '@/lib/pv/geo';

/** Rayon maximum d'une référence, en kilomètres. */
export const RAYON_REFERENCE_KM = 100;
/** Nombre maximum de références affichées. */
export const MAX_REFERENCES = 3;

export interface PvReference {
  /** Slug d'enseigne, pour le logo (« leclerc », « intermarche »…). */
  enseigne: string;
  /** Nom affiché (« E.Leclerc »). */
  nom: string;
  ville: string;
  distanceKm: number;
}

export interface ReferenceQuery {
  /** Affaire pour laquelle on cherche des voisins — exclue du résultat. */
  dealId: string;
  brandId: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Les trois clients citables les plus proches, du plus proche au plus lointain.
 *
 * La requête est bornée par une boîte englobante (100 km autour du magasin)
 * avant le calcul exact de distance : on ne charge jamais tous les clients de
 * l'enseigne pour n'en garder que trois.
 */
export async function findReferences(query: ReferenceQuery): Promise<PvReference[]> {
  // Sans enseigne ou sans coordonnées, aucune des conditions « même enseigne »
  // et « à moins de 100 km » ne peut être vérifiée : on n'affiche rien.
  if (!query.brandId || query.latitude == null || query.longitude == null) return [];

  const dLat = latDeltaForKm(RAYON_REFERENCE_KM);
  const dLng = lngDeltaForKm(RAYON_REFERENCE_KM, query.latitude);
  const maintenant = new Date();

  const candidats = await prisma.deal.findMany({
    where: {
      id: { not: query.dealId },
      citableReference: true,
      store: {
        brandId: query.brandId,
        latitude: { gte: query.latitude - dLat, lte: query.latitude + dLat },
        longitude: { gte: query.longitude - dLng, lte: query.longitude + dLng },
      },
      subscriptions: {
        some: {
          closingDate: { not: null },
          churned: false,
          // Abonnement encore en cours (ou sans date de fin renseignée).
          OR: [{ subscriptionEndDate: null }, { subscriptionEndDate: { gte: maintenant } }],
        },
      },
    },
    select: {
      id: true,
      store: {
        select: {
          name: true,
          city: true,
          latitude: true,
          longitude: true,
          brand: { select: { name: true } },
        },
      },
    },
    // Garde-fou : une enseigne dense peut avoir beaucoup de clients dans la
    // boîte englobante. On en lit assez pour que le tri par distance ait du sens,
    // sans charger la France entière.
    take: 200,
  });

  return candidats
    .map(deal => {
      const s = deal.store;
      if (s.latitude == null || s.longitude == null) return null;
      const km = distanceKm(query.latitude!, query.longitude!, s.latitude, s.longitude);
      if (km > RAYON_REFERENCE_KM) return null;
      const nom = s.brand?.name?.trim() || s.name.trim();
      return {
        enseigne: brandSlug(s.brand?.name),
        nom,
        ville: s.city.trim(),
        distanceKm: Math.round(km),
      } satisfies PvReference;
    })
    .filter((r): r is PvReference => r !== null)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, MAX_REFERENCES);
}

/**
 * Phrase du mail (« E.Leclerc Lunel, E.Leclerc Sète et E.Leclerc Nîmes »).
 * Chaîne vide quand il n'y a aucune référence — le bloc est alors masqué.
 */
export function referencesSentence(refs: PvReference[]): string {
  const noms = refs.map(r => `${r.nom} ${r.ville}`.trim());
  if (noms.length === 0) return '';
  if (noms.length === 1) return noms[0];
  return `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`;
}
