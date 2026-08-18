import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { USE_MOCK_DATA, mockDeals } from '@/lib/mockData';
import { searchKey, searchKeyIncludes } from '@/lib/searchText';
import { likeAnywhere, likeStartsWith, searchKeySql } from '@/lib/searchSql';

// Recherche typeahead des affaires (style Pipedrive) : renvoie les quelques
// affaires les plus pertinentes pour la saisie courante, toutes pipelines
// confondues. Données dynamiques, jamais mises en cache.
//
// La comparaison se fait sur des « clés de recherche » (minuscules, sans
// accents, sans espaces ni ponctuation — cf. src/lib/searchText.ts) : taper
// « saint loudeac » retrouve donc bien « Saint-Loudéac ».
export const dynamic = 'force-dynamic';

const LIMIT = 8;

// Score de pertinence : un nom de magasin qui commence par la requête passe en
// premier, puis ceux qui la contiennent, puis les correspondances enseigne, etc.
// (utilisé pour les données de démonstration ; en base, le classement est fait
// directement en SQL avec les mêmes règles).
function rank<T extends { store?: { name?: string | null; brand?: { name?: string | null } | null } | null }>(deals: T[], key: string): T[] {
  return deals
    .map(d => {
      const name = searchKey(d.store?.name);
      const brand = searchKey(d.store?.brand?.name);
      let score = 4;
      if (name === key) score = 0;
      else if (name.startsWith(key)) score = 1;
      else if (name.includes(key)) score = 2;
      else if (brand.includes(key)) score = 3;
      return { d, score };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, LIMIT)
    .map(s => s.d);
}

export async function GET(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim();
  // Le seuil de 2 caractères porte sur la clé : « l'é » ne vaut qu'une lettre.
  const key = searchKey(q);
  if (key.length < 2) return NextResponse.json([]);

  if (USE_MOCK_DATA) {
    const matches = mockDeals.filter(d =>
      searchKeyIncludes(d.store.name, q) ||
      searchKeyIncludes(d.store.city, q) ||
      searchKeyIncludes(d.store.brand?.name, q) ||
      searchKeyIncludes(d.contactCalling, q),
    );
    return NextResponse.json(rank(matches, key));
  }

  const anywhere = likeAnywhere(key);
  const startsWith = likeStartsWith(key);

  try {
    // 1) Sélection + classement des affaires en SQL, sur les clés normalisées.
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT d."id"
      FROM "Deal" d
      JOIN "Store" s ON s."id" = d."storeId"
      LEFT JOIN "Brand" b ON b."id" = s."brandId"
      CROSS JOIN LATERAL (
        SELECT ${searchKeySql('s."name"')}            AS name_key,
               ${searchKeySql('s."city"')}            AS city_key,
               ${searchKeySql('b."name"')}            AS brand_key,
               ${searchKeySql('d."directeur"')}       AS directeur_key,
               ${searchKeySql('d."contactCalling"')}  AS calling_key,
               ${searchKeySql('d."contactLastName"')} AS lastname_key,
               ${searchKeySql('d."dealEmail"')}       AS email_key
      ) k
      WHERE k.name_key      LIKE ${anywhere}
         OR k.city_key      LIKE ${anywhere}
         OR k.brand_key     LIKE ${anywhere}
         OR k.directeur_key LIKE ${anywhere}
         OR k.calling_key   LIKE ${anywhere}
         OR k.lastname_key  LIKE ${anywhere}
         OR k.email_key     LIKE ${anywhere}
      ORDER BY
        CASE
          WHEN k.name_key = ${key}            THEN 0
          WHEN k.name_key LIKE ${startsWith}  THEN 1
          WHEN k.name_key LIKE ${anywhere}    THEN 2
          WHEN k.brand_key LIKE ${anywhere}   THEN 3
          ELSE 4
        END,
        s."name" ASC
      LIMIT ${Prisma.raw(String(LIMIT))}
    `);

    if (rows.length === 0) return NextResponse.json([]);

    // 2) Chargement des affaires retenues, en conservant l'ordre du classement.
    const ids = rows.map(r => r.id);
    const deals = await prisma.deal.findMany({
      where: { id: { in: ids } },
      include: {
        store: { include: { brand: true } },
        column: true,
        pipeline: { select: { id: true, name: true } },
      },
    });
    const byId = new Map(deals.map(d => [d.id, d]));
    return NextResponse.json(ids.map(id => byId.get(id)).filter(Boolean));
  } catch (err) {
    console.error('[GET /api/deals/search]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
