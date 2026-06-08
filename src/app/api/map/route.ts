import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildGeocodeQuery, geocodeQuery } from '@/lib/geocode';

// Données dynamiques (lecture DB + géocodage) : jamais de cache statique.
export const dynamic = 'force-dynamic';

const PIPELINE_NAME = 'Prospection';

// Nombre de magasins géocodés en parallèle (la BAN tolère bien plus, mais on
// reste poli ; le résultat est de toute façon mis en cache en base).
const GEOCODE_CONCURRENCY = 5;

interface MapDeal {
  id: string;
  storeName: string;
  brandName: string | null;
  brandColor: string | null;
  columnTitle: string;
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

    // 1. Détermine les magasins à (re)géocoder : pas encore localisés, ou dont
    //    l'adresse a changé depuis le dernier géocodage.
    const toGeocode = deals
      .map((d) => d.store)
      .filter((store, idx, arr) => arr.findIndex((s) => s.id === store.id) === idx)
      .map((store) => ({ store, query: buildGeocodeQuery(store) }))
      .filter(({ store, query }) => {
        if (!query) return false;
        const needsCoords = store.latitude == null || store.longitude == null;
        const queryChanged = store.geocodeQuery !== query;
        return needsCoords || queryChanged;
      });

    // 2. Géocode par petits lots concurrents et persiste les coordonnées.
    const coordsById = new Map<string, { latitude: number; longitude: number }>();
    for (const { store } of toGeocode) {
      if (store.latitude != null && store.longitude != null) {
        coordsById.set(store.id, { latitude: store.latitude, longitude: store.longitude });
      }
    }

    for (let i = 0; i < toGeocode.length; i += GEOCODE_CONCURRENCY) {
      const batch = toGeocode.slice(i, i + GEOCODE_CONCURRENCY);
      await Promise.all(
        batch.map(async ({ store, query }) => {
          const result = await geocodeQuery(query);
          if (!result) return;
          coordsById.set(store.id, result);
          await prisma.store.update({
            where: { id: store.id },
            data: {
              latitude: result.latitude,
              longitude: result.longitude,
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
    return NextResponse.json({ error: 'Erreur serveur', deals: [], unlocated: 0 }, { status: 500 });
  }
}
