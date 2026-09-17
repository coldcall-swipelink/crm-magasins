// src/lib/pv/references.ts
//
// « Déjà avec Swipelink dans votre région » : les trois magasins voisins cités
// sur la page (et dans le mail).
//
// La règle est celle que le CRM applique déjà à la variable {{2mag}} des mails
// (cf. DealDrawer) : les magasins de la MÊME ENSEIGNE avec lesquels un test a
// déjà été fait, les plus proches d'abord. Concrètement, un magasin est cité si :
//
//   1. MÊME ENSEIGNE — au sens du directeur : un Super U se compare aux Super U
//      ET aux Hyper U, un « E.Leclerc » aux « Leclerc ». Les enseignes du CRM
//      sont saisies à la main et se dédoublent ; on compare donc par FAMILLE
//      d'enseigne (brandSlug), pas par identifiant de marque.
//
//   2. UN TEST A ÉTÉ FAIT — l'affaire est dans le pipeline « Closing » (démo
//      réservée, faite, relancée, smartlinkée… peu importe l'étape), OU la case
//      « Citable » de la fiche affaire est cochée. La case sert à citer un
//      magasin testé hors de ce pipeline, ou qui a explicitement donné son
//      accord.
//
//   3. LE PLUS PRÈS POSSIBLE — à moins de 100 km quand les deux magasins sont
//      géolocalisés (« dans votre région » est alors vrai). À défaut, le même
//      département. Et si rien ne se trouve à moins de 100 km, les plus proches
//      quand même : citer un Intermarché testé à 150 km vaut mieux qu'un bloc
//      vide — la page et le mail adaptent alors leur titre (referencesTitle).
//
// Aucune référence ne remonte ? La page masque le bloc et le mail aussi.

import { prisma } from '@/lib/prisma';
import { brandSlug } from '@/lib/pv/brands';
import { distanceKm } from '@/lib/pv/geo';
import { departmentCode } from '@/lib/phone/geo';
import { CLOSING_PIPELINE_NAME } from '@/lib/pipelineStages';

/** Rayon au-delà duquel une référence n'est plus « dans votre région ». */
export const RAYON_REFERENCE_KM = 100;
/** Nombre maximum de références affichées. */
export const MAX_REFERENCES = 3;

export interface PvReference {
  /** Slug d'enseigne, pour le logo (« leclerc », « intermarche »…). */
  enseigne: string;
  /** Nom affiché (« E.Leclerc »). */
  nom: string;
  ville: string;
  /** Distance à vol d'oiseau, ou null quand l'un des deux magasins n'est pas géolocalisé. */
  distanceKm: number | null;
}

export interface ReferenceQuery {
  /** Affaire pour laquelle on cherche des voisins — exclue du résultat. */
  dealId: string;
  brandId: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Département et code postal du magasin : repli quand les coordonnées manquent. */
  department?: string | null;
  postalCode?: string | null;
}

/** Identifiants de toutes les marques du CRM appartenant à la même famille d'enseigne. */
async function brandFamily(brandId: string): Promise<string[]> {
  const brands = await prisma.brand.findMany({ select: { id: true, name: true } });
  const self = brands.find(b => b.id === brandId);
  if (!self) return [brandId];
  const slug = brandSlug(self.name);
  if (!slug) return [brandId];
  return brands.filter(b => brandSlug(b.name) === slug).map(b => b.id);
}

/**
 * Les trois magasins testés les plus proches, du plus proche au plus lointain.
 *
 * Les candidats sont peu nombreux (les affaires « Closing » d'une enseigne) : on
 * les lit tous, puis on trie en mémoire par proximité.
 */
export async function findReferences(query: ReferenceQuery): Promise<PvReference[]> {
  // Sans enseigne, « même enseigne » ne veut rien dire : on n'affiche rien.
  if (!query.brandId) return [];

  const famille = await brandFamily(query.brandId);
  const candidats = await prisma.deal.findMany({
    where: {
      id: { not: query.dealId },
      store: { brandId: { in: famille } },
      OR: [{ pipeline: { name: CLOSING_PIPELINE_NAME } }, { citableReference: true }],
    },
    select: {
      id: true,
      store: {
        select: {
          name: true,
          city: true,
          postalCode: true,
          department: true,
          latitude: true,
          longitude: true,
          brand: { select: { name: true } },
        },
      },
    },
    take: 500,
  });

  const origineLocalisee = query.latitude != null && query.longitude != null;
  const departement = departmentCode({ department: query.department, postalCode: query.postalCode });

  type Classe = { ref: PvReference; rang: number; km: number };
  const classes: Classe[] = [];

  for (const deal of candidats) {
    const s = deal.store;
    const km =
      origineLocalisee && s.latitude != null && s.longitude != null
        ? distanceKm(query.latitude!, query.longitude!, s.latitude, s.longitude)
        : null;
    const memeDepartement = !!departement && departmentCode(s) === departement;

    // Rang 0 : à moins de 100 km. Rang 1 : distance inconnue mais même
    // département. Rang 2 : au-delà de 100 km. Le reste n'est pas « dans votre
    // région », ni de près ni de loin : écarté.
    let rang: number;
    if (km != null && km <= RAYON_REFERENCE_KM) rang = 0;
    else if (km == null && memeDepartement) rang = 1;
    else if (km != null) rang = 2;
    else continue;

    const nom = s.brand?.name?.trim() || s.name.trim();
    classes.push({
      rang,
      km: km ?? Number.POSITIVE_INFINITY,
      ref: {
        enseigne: brandSlug(s.brand?.name),
        nom,
        ville: s.city.trim(),
        distanceKm: km == null ? null : Math.round(km),
      },
    });
  }

  return classes
    .sort((a, b) => a.rang - b.rang || a.km - b.km || a.ref.ville.localeCompare(b.ref.ville, 'fr'))
    .slice(0, MAX_REFERENCES)
    .map(c => c.ref);
}

/** Vrai quand au moins une référence est réellement « dans votre région ». */
export function referencesAreNearby(refs: PvReference[]): boolean {
  return refs.some(r => r.distanceKm != null && r.distanceKm <= RAYON_REFERENCE_KM);
}

/**
 * Titre du bloc, sur la page comme dans le mail.
 *
 * « Dans votre région » n'est écrit que si c'est vrai. Sinon on s'appuie sur
 * l'enseigne (« Déjà avec Swipelink chez Intermarché »), et à défaut sur le
 * simple fait que ces magasins ont testé.
 */
export function referencesTitle(refs: PvReference[], enseigneNom: string): string {
  if (referencesAreNearby(refs)) return 'Déjà avec Swipelink dans votre région';
  const nom = enseigneNom.trim();
  return nom ? `Déjà avec Swipelink chez ${nom}` : 'Ils ont déjà testé Swipelink';
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
