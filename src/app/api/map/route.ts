import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildGeocodeQuery, geocodeQuery } from '@/lib/geocode';

// Données dynamiques (lecture DB + géocodage) : jamais de cache statique.
export const dynamic = 'force-dynamic';

const PIPELINE_NAME = 'Prospection';

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
    const pipeline = await prisma.pipeline.findUnique({
      where: { name: PIPELINE_NAME },
    });
    if (!pipeline) {
      return NextResponse.json(
        { error: `Pipeline « ${PIPELINE_NAME} » introuvable`, deals: [], unlocated: 0 },
        { status: 404 },
      );
    }

    const deals = await prisma.deal.findMany({
      where: { pipelineId: pipeline.id },
      include: {
        store: { include: { brand: true } },
        column: true,
      },
    });

    // 1. Magasins à géocoder : uniquement ceux dont l'adresse n'a PAS encore
    //    été tentée pour cette valeur exacte (geocodeQuery). Un échec est
    //    mémorisé (geocodeQuery enregistré, coordonnées laissées nulles) afin de
    //    ne JAMAIS le retenter à chaque chargement — c'était la cause des temps
    //    de chargement très longs avec beaucoup de deals.
    const toGeocode = deals
      .map((d) => d.store)
      .filter((store, idx, arr) => arr.findIndex((s) => s.id === store.id) === idx)
      .map((store) => ({ store, query: buildGeocodeQuery(store) }))
      .filter(({ store, query }) => query && store.geocodeQuery !== query)
      .slice(0, GEOCODE_MAX_PER_REQUEST);

    // 2. Géocode par lots concurrents ; persiste la tentative (succès OU échec).
    const coordsById = new Map<string, { latitude: number; longitude: number }>();
    for (let i = 0; i < toGeocode.length; i += GEOCODE_CONCURRENCY) {
      const batch = toGeocode.slice(i, i + GEOCODE_CONCURRENCY);
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
        columnTitle: deal.column.title,
        columnColor: deal.column.color,
        columnPosition: deal.column.position,
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
