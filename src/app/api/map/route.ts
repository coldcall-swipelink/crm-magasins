import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildGeocodeQuery, geocodeQuery } from '@/lib/geocode';

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
  priority: string;
  latitude: number;
  longitude: number;
}

export async function GET() {
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
    //    vide ou introuvable) sont comptés à part pour informer l'utilisateur.
    const located: MapDeal[] = [];
    let unlocated = 0;

    for (const deal of deals) {
      const store = deal.store;
      const cached = coordsById.get(store.id);
      const latitude = cached?.latitude ?? store.latitude ?? null;
      const longitude = cached?.longitude ?? store.longitude ?? null;

      if (latitude == null || longitude == null) {
        unlocated += 1;
        continue;
      }

      located.push({
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
        priority: deal.priority,
        latitude,
        longitude,
      });
    }

    return NextResponse.json({ deals: located, unlocated });
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
