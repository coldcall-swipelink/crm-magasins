// src/lib/pv/profiles.ts
//
// « N bouchers déjà repérés autour de votre magasin » : le nombre annoncé dans
// le mail et sur la page.
//
// ÉTAT DU PILOTE — c'est une ESTIMATION assumée, pas un comptage. La base de
// candidats produit ne porte pas encore de localisation exploitable : tant
// qu'elle n'en a pas, compter les candidats « boucher » à moins de 25 km n'est
// pas possible. On estime donc à partir de la seule chose dont on soit sûr :
// la taille de l'agglomération où se trouve le magasin, qui commande le vivier
// de bouchers alentour.
//
//   grande agglomération  → 70 à 88 profils
//   ville moyenne         → 46 à 58 profils
//   reste du territoire   → 30 à 42 profils
//
// Deux propriétés comptent autant que le chiffre lui-même :
//
//   • STABILITÉ — le nombre est tiré du magasin (empreinte de son identifiant),
//     jamais du hasard : le même magasin obtient toujours le même nombre. Le
//     mail annonce 74, la page affiche 74, et encore 74 trois semaines plus tard.
//     Le chiffre est en outre figé sur l'invitation (PvInvite.nbProfils) dès
//     l'envoi, ce qui le met à l'abri d'un changement de barème.
//
//   • REMPLAÇABILITÉ — tout passe par countButcherProfiles(). Le jour où les
//     candidats porteront un code postal ou des coordonnées, seule cette
//     fonction changera : une requête à 25 km, et le reste du pilote continue
//     sans y toucher.

import { distanceKm } from '@/lib/pv/geo';

export type VilleTier = 'grande' | 'moyenne' | 'petite';

/** Bornes du nombre annoncé, par taille d'agglomération. */
const BANDES: Record<VilleTier, [number, number]> = {
  grande: [70, 88],
  moyenne: [46, 58],
  petite: [30, 42],
};

/**
 * Agglomérations de référence, avec leurs coordonnées approximatives (au
 * kilomètre près, largement suffisant pour un test de proximité à 25 km).
 *
 * On raisonne en DISTANCE plutôt qu'en nom de commune : un magasin de
 * Saint-Jean-de-Védas ou de Vénissieux appartient au vivier de Montpellier ou
 * de Lyon, alors que son nom de commune ne le dirait jamais.
 */
const VILLES: Array<{ nom: string; lat: number; lng: number; tier: VilleTier }> = [
  // ─ Grandes agglomérations (≈ 150 000 habitants et plus) ─
  { nom: 'Paris', lat: 48.857, lng: 2.352, tier: 'grande' },
  { nom: 'Marseille', lat: 43.296, lng: 5.370, tier: 'grande' },
  { nom: 'Lyon', lat: 45.764, lng: 4.836, tier: 'grande' },
  { nom: 'Toulouse', lat: 43.605, lng: 1.444, tier: 'grande' },
  { nom: 'Nice', lat: 43.700, lng: 7.265, tier: 'grande' },
  { nom: 'Nantes', lat: 47.218, lng: -1.554, tier: 'grande' },
  { nom: 'Montpellier', lat: 43.611, lng: 3.877, tier: 'grande' },
  { nom: 'Strasbourg', lat: 48.573, lng: 7.752, tier: 'grande' },
  { nom: 'Bordeaux', lat: 44.838, lng: -0.579, tier: 'grande' },
  { nom: 'Lille', lat: 50.629, lng: 3.057, tier: 'grande' },
  { nom: 'Rennes', lat: 48.117, lng: -1.677, tier: 'grande' },
  { nom: 'Reims', lat: 49.258, lng: 4.032, tier: 'grande' },
  { nom: 'Toulon', lat: 43.125, lng: 5.930, tier: 'grande' },
  { nom: 'Saint-Étienne', lat: 45.439, lng: 4.387, tier: 'grande' },
  { nom: 'Le Havre', lat: 49.494, lng: 0.108, tier: 'grande' },
  { nom: 'Grenoble', lat: 45.188, lng: 5.724, tier: 'grande' },
  { nom: 'Dijon', lat: 47.322, lng: 5.041, tier: 'grande' },
  { nom: 'Angers', lat: 47.478, lng: -0.563, tier: 'grande' },
  { nom: 'Nîmes', lat: 43.837, lng: 4.360, tier: 'grande' },
  { nom: 'Clermont-Ferrand', lat: 45.777, lng: 3.087, tier: 'grande' },
  { nom: 'Le Mans', lat: 48.007, lng: 0.199, tier: 'grande' },
  { nom: 'Aix-en-Provence', lat: 43.529, lng: 5.447, tier: 'grande' },
  { nom: 'Brest', lat: 48.390, lng: -4.486, tier: 'grande' },
  { nom: 'Tours', lat: 47.394, lng: 0.684, tier: 'grande' },
  { nom: 'Amiens', lat: 49.894, lng: 2.296, tier: 'grande' },
  { nom: 'Limoges', lat: 45.833, lng: 1.261, tier: 'grande' },
  { nom: 'Metz', lat: 49.120, lng: 6.176, tier: 'grande' },
  { nom: 'Besançon', lat: 47.238, lng: 6.024, tier: 'grande' },
  { nom: 'Orléans', lat: 47.902, lng: 1.909, tier: 'grande' },
  { nom: 'Rouen', lat: 49.443, lng: 1.099, tier: 'grande' },
  { nom: 'Mulhouse', lat: 47.750, lng: 7.340, tier: 'grande' },
  { nom: 'Caen', lat: 49.183, lng: -0.370, tier: 'grande' },
  { nom: 'Nancy', lat: 48.692, lng: 6.184, tier: 'grande' },
  { nom: 'Avignon', lat: 43.949, lng: 4.806, tier: 'grande' },
  { nom: 'Perpignan', lat: 42.699, lng: 2.895, tier: 'grande' },
  { nom: 'Annecy', lat: 45.899, lng: 6.129, tier: 'grande' },
  { nom: 'Saint-Denis (La Réunion)', lat: -20.882, lng: 55.450, tier: 'grande' },

  // ─ Villes moyennes (≈ 50 000 à 150 000 habitants) ─
  { nom: 'Pau', lat: 43.298, lng: -0.370, tier: 'moyenne' },
  { nom: 'Bayonne', lat: 43.493, lng: -1.475, tier: 'moyenne' },
  { nom: 'La Rochelle', lat: 46.160, lng: -1.152, tier: 'moyenne' },
  { nom: 'Poitiers', lat: 46.580, lng: 0.340, tier: 'moyenne' },
  { nom: 'Valence', lat: 44.933, lng: 4.892, tier: 'moyenne' },
  { nom: 'Troyes', lat: 48.297, lng: 4.074, tier: 'moyenne' },
  { nom: 'Chambéry', lat: 45.564, lng: 5.917, tier: 'moyenne' },
  { nom: 'Lorient', lat: 47.748, lng: -3.367, tier: 'moyenne' },
  { nom: 'Vannes', lat: 47.658, lng: -2.760, tier: 'moyenne' },
  { nom: 'Saint-Nazaire', lat: 47.273, lng: -2.213, tier: 'moyenne' },
  { nom: 'Quimper', lat: 47.996, lng: -4.103, tier: 'moyenne' },
  { nom: 'Saint-Brieuc', lat: 48.514, lng: -2.765, tier: 'moyenne' },
  { nom: 'Béziers', lat: 43.344, lng: 3.216, tier: 'moyenne' },
  { nom: 'Narbonne', lat: 43.184, lng: 3.004, tier: 'moyenne' },
  { nom: 'Carcassonne', lat: 43.213, lng: 2.351, tier: 'moyenne' },
  { nom: 'Cannes', lat: 43.552, lng: 7.017, tier: 'moyenne' },
  { nom: 'Antibes', lat: 43.581, lng: 7.125, tier: 'moyenne' },
  { nom: 'Fréjus', lat: 43.433, lng: 6.737, tier: 'moyenne' },
  { nom: 'Calais', lat: 50.948, lng: 1.856, tier: 'moyenne' },
  { nom: 'Dunkerque', lat: 51.035, lng: 2.377, tier: 'moyenne' },
  { nom: 'Arras', lat: 50.291, lng: 2.778, tier: 'moyenne' },
  { nom: 'Valenciennes', lat: 50.358, lng: 3.523, tier: 'moyenne' },
  { nom: 'Colmar', lat: 48.079, lng: 7.358, tier: 'moyenne' },
  { nom: 'Belfort', lat: 47.638, lng: 6.864, tier: 'moyenne' },
  { nom: 'Chalon-sur-Saône', lat: 46.781, lng: 4.854, tier: 'moyenne' },
  { nom: 'Bourges', lat: 47.084, lng: 2.396, tier: 'moyenne' },
  { nom: 'Châteauroux', lat: 46.811, lng: 1.690, tier: 'moyenne' },
  { nom: 'Blois', lat: 47.586, lng: 1.335, tier: 'moyenne' },
  { nom: 'Chartres', lat: 48.444, lng: 1.489, tier: 'moyenne' },
  { nom: 'Beauvais', lat: 49.430, lng: 2.081, tier: 'moyenne' },
  { nom: 'Compiègne', lat: 49.418, lng: 2.826, tier: 'moyenne' },
  { nom: 'Saint-Quentin', lat: 49.848, lng: 3.287, tier: 'moyenne' },
  { nom: 'Charleville-Mézières', lat: 49.773, lng: 4.720, tier: 'moyenne' },
  { nom: 'Épinal', lat: 48.174, lng: 6.451, tier: 'moyenne' },
  { nom: 'Thionville', lat: 49.358, lng: 6.169, tier: 'moyenne' },
  { nom: 'Montauban', lat: 44.018, lng: 1.355, tier: 'moyenne' },
  { nom: 'Albi', lat: 43.928, lng: 2.148, tier: 'moyenne' },
  { nom: 'Tarbes', lat: 43.233, lng: 0.072, tier: 'moyenne' },
  { nom: 'Agen', lat: 44.203, lng: 0.618, tier: 'moyenne' },
  { nom: 'Périgueux', lat: 45.184, lng: 0.721, tier: 'moyenne' },
  { nom: 'Angoulême', lat: 45.650, lng: 0.159, tier: 'moyenne' },
  { nom: 'Niort', lat: 46.324, lng: -0.464, tier: 'moyenne' },
  { nom: 'Cholet', lat: 47.059, lng: -0.878, tier: 'moyenne' },
  { nom: 'Laval', lat: 48.073, lng: -0.770, tier: 'moyenne' },
  { nom: 'Alençon', lat: 48.431, lng: 0.093, tier: 'moyenne' },
  { nom: 'Cherbourg', lat: 49.639, lng: -1.616, tier: 'moyenne' },
  { nom: 'Évreux', lat: 49.025, lng: 1.151, tier: 'moyenne' },
  { nom: 'Dieppe', lat: 49.923, lng: 1.078, tier: 'moyenne' },
  { nom: 'Auxerre', lat: 47.798, lng: 3.573, tier: 'moyenne' },
  { nom: 'Nevers', lat: 46.989, lng: 3.159, tier: 'moyenne' },
  { nom: 'Moulins', lat: 46.565, lng: 3.334, tier: 'moyenne' },
  { nom: 'Vichy', lat: 46.127, lng: 3.426, tier: 'moyenne' },
  { nom: 'Roanne', lat: 46.036, lng: 4.068, tier: 'moyenne' },
  { nom: 'Bourg-en-Bresse', lat: 46.205, lng: 5.226, tier: 'moyenne' },
  { nom: 'Montélimar', lat: 44.556, lng: 4.750, tier: 'moyenne' },
  { nom: 'Aubenas', lat: 44.621, lng: 4.390, tier: 'moyenne' },
  { nom: 'Gap', lat: 44.559, lng: 6.079, tier: 'moyenne' },
  { nom: 'Ajaccio', lat: 41.927, lng: 8.737, tier: 'moyenne' },
  { nom: 'Bastia', lat: 42.700, lng: 9.450, tier: 'moyenne' },
  { nom: 'Fort-de-France', lat: 14.616, lng: -61.058, tier: 'moyenne' },
  { nom: 'Pointe-à-Pitre', lat: 16.241, lng: -61.533, tier: 'moyenne' },
  { nom: 'Cayenne', lat: 4.933, lng: -52.330, tier: 'moyenne' },
  { nom: 'Saint-Pierre (La Réunion)', lat: -21.341, lng: 55.478, tier: 'moyenne' },
];

/** Rayon d'appartenance à une agglomération, en kilomètres. */
const RAYON_AGGLO_KM = 25;

/**
 * Taille de l'agglomération d'un magasin, d'après ses coordonnées.
 * Sans coordonnées, on reste prudent : « moyenne ».
 */
export function tierForLocation(lat: number | null, lng: number | null): VilleTier {
  if (lat == null || lng == null) return 'moyenne';
  let meilleur: VilleTier = 'petite';
  for (const ville of VILLES) {
    if (distanceKm(lat, lng, ville.lat, ville.lng) > RAYON_AGGLO_KM) continue;
    // Un magasin peut être dans le rayon de deux villes (Aix / Marseille) :
    // la plus grande l'emporte.
    if (ville.tier === 'grande') return 'grande';
    if (ville.tier === 'moyenne') meilleur = 'moyenne';
  }
  return meilleur;
}

/**
 * Empreinte entière et stable d'une chaîne (FNV-1a 32 bits). Sert à tirer un
 * nombre dans la bande : même magasin, même nombre, pour toujours.
 */
function empreinte(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface ProfileCountInput {
  /** Identifiant du magasin : ce qui rend le tirage stable. */
  storeId: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Nombre de profils « boucher » annoncé pour un magasin.
 *
 * Point d'entrée unique, à remplacer par un vrai comptage à 25 km dès que les
 * candidats seront localisés.
 */
export function countButcherProfiles(input: ProfileCountInput): number {
  const tier = tierForLocation(input.latitude, input.longitude);
  const [min, max] = BANDES[tier];
  return min + (empreinte(input.storeId) % (max - min + 1));
}
