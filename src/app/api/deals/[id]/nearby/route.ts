import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { USE_MOCK_DATA, mockDeals, mockPipelines } from '@/lib/mockData';

// Magasins du CRM proches (< 50 km) de l'affaire courante, avec leur étape de
// pipeline. Calcul de distance Haversine côté serveur sur les coordonnées déjà
// géocodées (les magasins non localisés sont ignorés). Jamais mis en cache.
export const dynamic = 'force-dynamic';

const RADIUS_KM = 50;

/** Distance en km entre deux points (formule de Haversine). */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface NearbyDeal {
  dealId: string;
  storeName: string;
  brandName: string | null;
  brandColor: string | null;
  city: string;
  postalCode: string;
  columnTitle: string;
  columnColor: string;
  pipelineName: string;
  distanceKm: number;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (USE_MOCK_DATA) {
    const self = mockDeals.find((d) => d.id === params.id);
    if (!self) return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });
    const s = self.store as any;
    if (s.latitude == null || s.longitude == null) {
      return NextResponse.json({ deals: [], originLocated: false });
    }
    const out: NearbyDeal[] = [];
    for (const d of mockDeals) {
      if (d.id === self.id) continue;
      const st = d.store as any;
      if (st.latitude == null || st.longitude == null) continue;
      const distanceKm = haversineKm(s.latitude, s.longitude, st.latitude, st.longitude);
      if (distanceKm > RADIUS_KM) continue;
      out.push({
        dealId: d.id,
        storeName: st.name,
        brandName: st.brand?.name ?? null,
        brandColor: st.brand?.color ?? null,
        city: st.city ?? '',
        postalCode: st.postalCode ?? '',
        columnTitle: (d.column as any)?.title ?? '',
        columnColor: (d.column as any)?.color ?? '#94a3b8',
        pipelineName: mockPipelines.find((p) => p.id === d.pipelineId)?.name ?? '',
        distanceKm: Math.round(distanceKm * 10) / 10,
      });
    }
    out.sort((a, b) => a.distanceKm - b.distanceKm);
    return NextResponse.json({ deals: out, originLocated: true });
  }

  try {
    const self = await prisma.deal.findUnique({ where: { id: params.id }, include: { store: true } });
    if (!self) return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });
    const { latitude, longitude } = self.store;
    if (latitude == null || longitude == null) {
      return NextResponse.json({ deals: [], originLocated: false });
    }

    const deals = await prisma.deal.findMany({
      where: {
        id: { not: self.id },
        store: { latitude: { not: null }, longitude: { not: null } },
      },
      include: {
        store: { include: { brand: true } },
        column: true,
        pipeline: { select: { name: true } },
      },
    });

    const out: NearbyDeal[] = [];
    for (const d of deals) {
      const st = d.store;
      const distanceKm = haversineKm(latitude, longitude, st.latitude as number, st.longitude as number);
      if (distanceKm > RADIUS_KM) continue;
      out.push({
        dealId: d.id,
        storeName: st.name,
        brandName: st.brand?.name ?? null,
        brandColor: st.brand?.color ?? null,
        city: st.city,
        postalCode: st.postalCode,
        columnTitle: d.column.title,
        columnColor: d.column.color,
        pipelineName: d.pipeline.name,
        distanceKm: Math.round(distanceKm * 10) / 10,
      });
    }
    out.sort((a, b) => a.distanceKm - b.distanceKm);
    return NextResponse.json({ deals: out, originLocated: true });
  } catch (err) {
    console.error('[GET /api/deals/[id]/nearby]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
