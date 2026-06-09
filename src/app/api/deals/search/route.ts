import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { USE_MOCK_DATA, mockDeals } from '@/lib/mockData';

// Recherche typeahead des affaires (style Pipedrive) : renvoie les quelques
// affaires les plus pertinentes pour la saisie courante, toutes pipelines
// confondues. Données dynamiques, jamais mises en cache.
export const dynamic = 'force-dynamic';

const LIMIT = 8;

// Score de pertinence : un nom de magasin qui commence par la requête passe en
// premier, puis ceux qui la contiennent, puis les correspondances enseigne, etc.
function rank<T extends { store?: { name?: string | null; brand?: { name?: string | null } | null } | null }>(deals: T[], q: string): T[] {
  return deals
    .map(d => {
      const name = (d.store?.name || '').toLowerCase();
      const brand = (d.store?.brand?.name || '').toLowerCase();
      let score = 4;
      if (name === q) score = 0;
      else if (name.startsWith(q)) score = 1;
      else if (name.includes(q)) score = 2;
      else if (brand.includes(q)) score = 3;
      return { d, score };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, LIMIT)
    .map(s => s.d);
}

export async function GET(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim();
  if (q.length < 2) return NextResponse.json([]);
  const nq = q.toLowerCase();

  if (USE_MOCK_DATA) {
    const matches = mockDeals.filter(d =>
      d.store.name.toLowerCase().includes(nq) ||
      d.store.city.toLowerCase().includes(nq) ||
      (d.store.brand ? d.store.brand.name.toLowerCase().includes(nq) : false) ||
      d.contactCalling.toLowerCase().includes(nq),
    );
    return NextResponse.json(rank(matches, nq));
  }

  try {
    const deals = await prisma.deal.findMany({
      where: {
        OR: [
          { store: { name:  { contains: q, mode: 'insensitive' } } },
          { store: { city:  { contains: q, mode: 'insensitive' } } },
          { store: { brand: { name: { contains: q, mode: 'insensitive' } } } },
          { directeur:       { contains: q, mode: 'insensitive' } },
          { contactCalling:  { contains: q, mode: 'insensitive' } },
          { contactLastName: { contains: q, mode: 'insensitive' } },
          { dealEmail:       { contains: q, mode: 'insensitive' } },
        ],
      },
      include: {
        store: { include: { brand: true } },
        column: true,
        pipeline: { select: { id: true, name: true } },
      },
      take: 25,
    });
    return NextResponse.json(rank(deals, nq));
  } catch (err) {
    console.error('[GET /api/deals/search]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
