// src/lib/searchSql.ts
//
// Version SQL (PostgreSQL) de la normalisation de src/lib/searchText.ts : elle
// permet de comparer, directement en base, la clé de recherche d'une colonne à
// celle saisie par l'utilisateur — donc de retrouver « Saint-Loudéac » en
// tapant « saint loudeac », sans extension PostgreSQL ni colonne dédiée.
//
// La table de correspondance des lettres est celle de searchText.ts : les deux
// implémentations produisent, par construction, exactement les mêmes clés.
import { Prisma } from '@prisma/client';
import { FOLD_TABLE } from './searchText';

/**
 * Expression SQL calculant la clé de recherche d'une colonne — équivalent de
 * `searchKey()` côté JavaScript : minuscules, lettres ramenées à l'ASCII
 * (`translate` pour les équivalents à un caractère, `replace` pour œ, ß…),
 * puis suppression de tout ce qui n'est ni lettre ni chiffre.
 *
 * `column` est un fragment SQL écrit par l'application (ex. `s."name"`),
 * jamais une valeur venant de l'utilisateur.
 */
export function searchKeySql(column: string): Prisma.Sql {
  let expr = Prisma.sql`lower(coalesce(${Prisma.raw(column)}, ''))`;
  for (const [char, ascii] of FOLD_TABLE.multi) {
    expr = Prisma.sql`replace(${expr}, ${char}, ${ascii})`;
  }
  return Prisma.sql`regexp_replace(translate(${expr}, ${FOLD_TABLE.from}, ${FOLD_TABLE.to}), '[^a-z0-9]+', '', 'g')`;
}

/**
 * Motif `LIKE` cherchant la clé n'importe où dans la valeur. Les caractères
 * spéciaux de LIKE (`%`, `_`, `\`) sont échappés : une clé de recherche n'en
 * contient jamais, mais on ne prend pas le risque.
 */
export function likeAnywhere(key: string): string {
  return `%${key.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Motif `LIKE` cherchant les valeurs qui *commencent* par la clé. */
export function likeStartsWith(key: string): string {
  return `${key.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
