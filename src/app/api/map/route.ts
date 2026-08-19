import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildGeocodeQuery, geocodeQuery } from '@/lib/geocode';
import { USE_MOCK_DATA, mockDeals, mockPipelines } from '@/lib/mockData';

// Données dynamiques (lecture DB + géocodage) : jamais de cache statique.
export const dynamic = 'force-dynamic';

// Pipelines affichés sur la carte. L'ordre du tableau sert aussi à ordonner
// les étapes dans la légende/filtre (les colonnes de « Closing » viennent
// après celles de « Prospection »).
const PIPELINE_NAMES = ['Prospection', 'Closing'] as const;

// Nombre de magasins géocodés en parallèle (la BAN tolère bien plus, mais on
// reste poli ; le résultat est de toute façon mis en cache en base).
const GEOCODE_CONCURRENCY = 12;

// Plafond de géocodages par requête : borne le temps de réponse même avec
// beaucoup de nouveaux magasins. Le reste est géocodé aux chargements suivants
// (chaque adresse n'étant géocodée qu'une seule fois, succès comme échec).
const GEOCODE_MAX_PER_REQUEST = 150;

interface MapDeal {
  id: string;
  storeName: string;
  brandName: string | null;
  brandColor: string | null;
  pipelineName: string;
  columnTitle: string;
  columnColor: string;
  columnPosition: number;
  city: string;
  postalCode: string;
  address: string;
  phone: string;
  priority: string;
  // Tag commercial de l'affaire (Prospection de Valeur / Classique), affiché
  // en pastille dans la liste de la carte.
  isPV: boolean;
  // Affaire cliente : étape « SMARTLINKÉ » ou « LIEN DE PAIEMENT ENVOYÉ ».
  // Alimente l'onglet « Clients » de la carte.
  isClient: boolean;
  // Null quand l'adresse est vide ou introuvable : le magasin apparaît alors
  // dans la liste latérale en « non localisé », avec un bouton « Localiser ».
  latitude: number | null;
  longitude: number | null;
}

// Boîtes géographiques de la France (métropole + outre-mer), en
// [latMin, latMax, lngMin, lngMax]. Une coordonnée qui tombe hors de toutes ces
// boîtes ne peut pas être un magasin français : c'est une donnée abîmée
// (0,0 « null island », latitude et longitude inversées, adresse résolue à
// l'étranger). On ne la place pas sur la carte — le magasin est compté « non
// localisé » et repositionnable à la main — plutôt que de laisser un point
// aberrant étirer le cadrage jusqu'à l'Afrique.
const FRANCE_BOXES: ReadonlyArray<readonly [number, number, number, number]> = [
  [41.0, 51.5, -5.8, 10.0],      // métropole + Corse
  [14.0, 16.6, -61.9, -60.7],    // Guadeloupe, Martinique
  [2.0, 6.0, -55.0, -51.0],      // Guyane
  [-21.5, -20.8, 55.1, 55.9],    // La Réunion
  [-13.2, -12.5, 44.9, 45.4],    // Mayotte
  [46.7, 47.2, -56.6, -56.0],    // Saint-Pierre-et-Miquelon
  [-22.9, -19.5, 163.5, 168.2],  // Nouvelle-Calédonie
  [-28.0, -7.0, -155.0, -134.0], // Polynésie française
];

function isInFrance(latitude: number | null, longitude: number | null): boolean {
  if (latitude == null || longitude == null) return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return FRANCE_BOXES.some(
    ([latMin, latMax, lngMin, lngMax]) =>
      latitude >= latMin && latitude <= latMax && longitude >= lngMin && longitude <= lngMax,
  );
}

/** Normalise un titre de colonne (minuscules, sans accents) pour comparaison. */
function normTitle(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/**
 * Vrai si l'étape désigne un client : « SMARTLINKÉ » ou « LIEN DE PAIEMENT
 * ENVOYÉ ». Comparaison sur le titre normalisé (minuscules, sans accents) et
 * par inclusion, pour rester insensible aux variantes de libellé.
 */
function isClientColumn(title: string): boolean {
  const t = normTitle(title);
  return t.includes('smartlink') || t.includes('lien de paiement');
}

/** Payload carte construit depuis les données fictives (cf. src/lib/mockData). */
function mockPayload(): { deals: MapDeal[]; unlocated: number } {
  const pipelines = mockPipelines.filter((p) => PIPELINE_NAMES.includes(p.name as (typeof PIPELINE_NAMES)[number]));
  const rankById = new Map(pipelines.map((p) => [p.id, Math.max(0, PIPELINE_NAMES.indexOf(p.name as (typeof PIPELINE_NAMES)[number]))] as const));
  const nameById = new Map(pipelines.map((p) => [p.id, p.name] as const));

  const deals: MapDeal[] = [];
  let unlocated = 0;

  for (const deal of mockDeals) {
    if (!nameById.has(deal.pipelineId)) continue;
    const store = deal.store;
    const placed = isInFrance(store.latitude, store.longitude);
    if (!placed) unlocated += 1;
    deals.push({
      id: deal.id,
      storeName: store.name,
      brandName: store.brand?.name ?? null,
      brandColor: store.brand?.color ?? null,
      pipelineName: nameById.get(deal.pipelineId) ?? '',
      columnTitle: deal.column?.title ?? '',
      columnColor: deal.column?.color ?? '',
      columnPosition: (rankById.get(deal.pipelineId) ?? 0) * 1000 + (deal.column?.position ?? 0),
      city: store.city,
      postalCode: store.postalCode,
      address: store.address,
      phone: store.phone,
      priority: deal.priority,
      // Les affaires fictives n'ont pas de tag PV explicite : on retient la
      // valeur par défaut du schéma Prisma (isPV = true).
      isPV: true,
      isClient: isClientColumn(deal.column?.title ?? ''),
      latitude: placed ? store.latitude : null,
      longitude: placed ? store.longitude : null,
    });
  }

  return { deals, unlocated };
}

export async function GET() {
  // Mode données fictives (preview / démo) : mêmes champs, sans base ni BAN.
  if (USE_MOCK_DATA) return NextResponse.json(mockPayload());

  try {
    const pipelines = await prisma.pipeline.findMany({
      where: { name: { in: [...PIPELINE_NAMES] } },
    });
    if (pipelines.length === 0) {
      return NextResponse.json(
        { error: `Aucun pipeline parmi ${PIPELINE_NAMES.join(', ')} introuvable`, deals: [], unlocated: 0 },
        { status: 404 },
      );
    }

    // Ordre d'affichage des étapes : on décale les positions de colonnes par
    // pipeline (selon l'ordre de PIPELINE_NAMES) pour éviter que les colonnes de
    // « Closing » (position 0,1,2…) ne se mélangent à celles de « Prospection ».
    const pipelineRank = new Map(
      pipelines.map((p) => [p.id, Math.max(0, PIPELINE_NAMES.indexOf(p.name as (typeof PIPELINE_NAMES)[number]))] as const),
    );
    const pipelineNameById = new Map(pipelines.map((p) => [p.id, p.name] as const));

    const deals = await prisma.deal.findMany({
      where: { pipelineId: { in: pipelines.map((p) => p.id) } },
      include: {
        store: { include: { brand: true } },
        column: true,
      },
    });

    // Magasins uniques + requête de géocodage associée.
    const uniqueStores = deals
      .map((d) => d.store)
      .filter((store, idx, arr) => arr.findIndex((s) => s.id === store.id) === idx)
      .map((store) => ({ store, query: buildGeocodeQuery(store) }));

    const coordsById = new Map<string, { latitude: number; longitude: number }>();

    // 1. Coordonnées déjà connues, indexées par requête d'adresse. La
    //    duplication vers « Closing » recrée un magasin (même adresse) sans
    //    recopier le géocodage : on réutilise donc les coordonnées d'un magasin
    //    déjà localisé partageant la même adresse, plutôt que de re-solliciter
    //    la BAN. C'est instantané et ça localise d'emblée les deals dupliqués.
    const knownByQuery = new Map<string, { latitude: number; longitude: number }>();
    for (const { store, query } of uniqueStores) {
      if (query && store.latitude != null && store.longitude != null && !knownByQuery.has(query)) {
        knownByQuery.set(query, { latitude: store.latitude, longitude: store.longitude });
      }
    }

    // 2. Magasins à traiter : ceux dont l'adresse n'a PAS encore été résolue
    //    pour cette valeur exacte (geocodeQuery). Un échec est mémorisé
    //    (geocodeQuery enregistré, coordonnées nulles) pour ne jamais le
    //    retenter à chaque chargement.
    const pending = uniqueStores.filter(
      ({ store, query }) => query && store.geocodeQuery !== query,
    );

    // 2a. Résolution immédiate par réutilisation des coordonnées connues
    //     (aucune limite, aucun appel réseau) ; on persiste pour les chargements
    //     suivants.
    const toGeocode: typeof pending = [];
    for (const item of pending) {
      const reuse = knownByQuery.get(item.query);
      if (reuse) {
        coordsById.set(item.store.id, reuse);
        await prisma.store.update({
          where: { id: item.store.id },
          data: { latitude: reuse.latitude, longitude: reuse.longitude, geocodeQuery: item.query, geocodedAt: new Date() },
        });
      } else {
        toGeocode.push(item);
      }
    }

    // 2b. Le reste est géocodé via la BAN, borné par requête.
    const toGeocodeCapped = toGeocode.slice(0, GEOCODE_MAX_PER_REQUEST);
    for (let i = 0; i < toGeocodeCapped.length; i += GEOCODE_CONCURRENCY) {
      const batch = toGeocodeCapped.slice(i, i + GEOCODE_CONCURRENCY);
      await Promise.all(
        batch.map(async ({ store, query }) => {
          const result = await geocodeQuery(query);
          if (result) coordsById.set(store.id, result);
          await prisma.store.update({
            where: { id: store.id },
            data: {
              ...(result ? { latitude: result.latitude, longitude: result.longitude } : {}),
              geocodeQuery: query,
              geocodedAt: new Date(),
            },
          });
        }),
      );
    }

    // 3. Construit le payload carte. Les magasins sans coordonnées (adresse
    //    vide ou introuvable) sont renvoyés AVEC latitude/longitude à null :
    //    la carte les liste à part et propose de les localiser à la main.
    const mapDeals: MapDeal[] = [];
    let unlocated = 0;

    for (const deal of deals) {
      const store = deal.store;
      const cached = coordsById.get(store.id);
      const rawLatitude = cached?.latitude ?? store.latitude ?? null;
      const rawLongitude = cached?.longitude ?? store.longitude ?? null;
      const placed = isInFrance(rawLatitude, rawLongitude);
      const latitude = placed ? rawLatitude : null;
      const longitude = placed ? rawLongitude : null;

      if (!placed) unlocated += 1;

      mapDeals.push({
        id: deal.id,
        storeName: store.name,
        brandName: store.brand?.name ?? null,
        brandColor: store.brand?.color ?? null,
        pipelineName: pipelineNameById.get(deal.pipelineId) ?? '',
        columnTitle: deal.column.title,
        columnColor: deal.column.color,
        columnPosition: (pipelineRank.get(deal.pipelineId) ?? 0) * 1000 + deal.column.position,
        city: store.city,
        postalCode: store.postalCode,
        address: store.address,
        phone: store.phone,
        priority: deal.priority,
        isPV: deal.isPV,
        isClient: isClientColumn(deal.column.title),
        latitude,
        longitude,
      });
    }

    return NextResponse.json({ deals: mapDeals, unlocated });
  } catch (err) {
    console.error('[GET /api/map]', err);
    // On expose le détail de l'erreur (message + code Prisma) pour faciliter
    // le diagnostic en prod : distinguer une base injoignable (« Can't reach
    // database server… ») d'un schéma non migré (« column … does not exist »).
    const detail = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: unknown }).code : undefined;
    return NextResponse.json({ error: 'Erreur serveur', detail, code, deals: [], unlocated: 0 }, { status: 500 });
  }
}
