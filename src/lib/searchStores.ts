// src/lib/searchStores.ts
//
// Résolution des magasins correspondant à une saisie de recherche, sur les
// « clés » normalisées (minuscules, sans accents, sans ponctuation — cf.
// src/lib/searchText.ts). Taper « saint loudeac » retrouve « Saint-Loudéac ».
//
// POURQUOI PASSER PAR DES IDS. Les filtres Prisma comparent du texte brut :
// `contains` avec `mode: 'insensitive'` n'ignore que la casse, pas les accents
// ni les tirets. Plutôt que de réécrire en SQL brut chaque route qui cherche
// des affaires — chacune ayant ses propres jointures, tris et paginations — on
// résout d'abord les magasins concernés, puis chaque route filtre normalement
// sur `storeId`. Son `where` Prisma reste intact.
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { searchKey } from '@/lib/searchText';
import { likeAnywhere, likeStartsWith, searchKeySql } from '@/lib/searchSql';

/**
 * Garde-fou : une requête de deux caractères peut correspondre à énormément de
 * magasins, et la liste d'ids finit dans un `IN (…)`. Au-delà on tronque, mais
 * jamais en silence (voir le console.warn).
 */
const MAX_STORE_IDS = 20_000;

/**
 * Ids des magasins dont le nom, la ville ou l'enseigne contient la saisie,
 * accents / casse / ponctuation ignorés.
 *
 * Renvoie `null` quand la saisie ne contient rien d'exploitable (« ??? ») :
 * l'appelant ne doit alors appliquer aucun filtre. Un tableau vide, lui,
 * signifie bien « aucun magasin ne correspond ».
 *
 * `includePostalCode` ajoute les codes postaux, comparés par PRÉFIXE — c'est ce
 * qu'attend la saisie manuelle des numéros (« 35 » = tout l'Ille-et-Vilaine),
 * alors qu'ailleurs cela élargirait la recherche sans raison.
 */
export async function findStoreIdsMatchingSearch(
  query: string,
  { includePostalCode = false }: { includePostalCode?: boolean } = {},
): Promise<string[] | null> {
  const key = searchKey(query);
  if (!key) return null;

  const anywhere = likeAnywhere(key);
  const postalCondition = includePostalCode
    ? Prisma.sql`OR k.postal_key LIKE ${likeStartsWith(key)}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT s."id"
    FROM "Store" s
    LEFT JOIN "Brand" b ON b."id" = s."brandId"
    CROSS JOIN LATERAL (
      SELECT ${searchKeySql('s."name"')}       AS name_key,
             ${searchKeySql('s."city"')}       AS city_key,
             ${searchKeySql('b."name"')}       AS brand_key,
             ${searchKeySql('s."postalCode"')} AS postal_key
    ) k
    WHERE k.name_key  LIKE ${anywhere}
       OR k.city_key  LIKE ${anywhere}
       OR k.brand_key LIKE ${anywhere}
       ${postalCondition}
    LIMIT ${Prisma.raw(String(MAX_STORE_IDS))}
  `);

  if (rows.length === MAX_STORE_IDS) {
    console.warn(`Recherche « ${query} » : plus de ${MAX_STORE_IDS} magasins correspondent, résultats tronqués.`);
  }
  return rows.map(r => r.id);
}
