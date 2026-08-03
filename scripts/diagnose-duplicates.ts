// scripts/diagnose-duplicates.ts
//
// Diagnostic (LECTURE SEULE) des doublons de magasins/affaires.
//
// But : comprendre POURQUOI deux magasins qui devraient être « le même »
// (même enseigne + même nom) ne se rapprochent pas à l'import. On regarde les
// champs qui servent à la déduplication : name / normalizedName / brand /
// city / deduplicationKey.
//
// Lancement (même mécanique que `npm run db:seed`) :
//   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/diagnose-duplicates.ts
//
// N'écrit RIEN en base.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Même normalisation que src/lib/utils.ts (copiée ici pour rester autonome). */
function normalizeText(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const stores = await prisma.store.findMany({
    include: {
      brand: { select: { name: true } },
      deal: { select: { id: true, columnId: true } },
    },
    orderBy: { normalizedName: 'asc' },
  });

  console.log(`\n${stores.length} magasins en base.\n`);

  // 1) Groupes de doublons : magasins partageant le MÊME nom normalisé recalculé
  //    (indépendamment de la valeur stockée, qui peut être incohérente).
  const groups = new Map<string, typeof stores>();
  for (const s of stores) {
    const key = normalizeText(s.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const dupGroups = [...groups.entries()].filter(([, arr]) => arr.length > 1);

  console.log('══════════════════════════════════════════════════════════════');
  console.log(`DOUBLONS PAR NOM (même nom normalisé sur plusieurs magasins) : ${dupGroups.length} groupe(s)`);
  console.log('══════════════════════════════════════════════════════════════');
  for (const [key, arr] of dupGroups) {
    console.log(`\n▸ « ${key} »  (${arr.length} magasins)`);
    for (const s of arr) {
      console.log(
        `   - store=${s.id}` +
        ` | deal=${s.deal?.id ?? 'AUCUN'}` +
        ` | enseigne=${JSON.stringify(s.brand?.name ?? null)}` +
        ` | name=${JSON.stringify(s.name)}` +
        ` | normalizedName=${JSON.stringify(s.normalizedName)}` +
        ` | city=${JSON.stringify(s.city)}` +
        ` | dedupKey=${JSON.stringify(s.deduplicationKey)}`,
      );
    }
  }

  // 2) Zoom bannière « U » (Super U / Hyper U / U Express / U…) : ce sont les
  //    cas signalés. On liste tous ces magasins pour repérer les enseignes /
  //    clés hétérogènes.
  const uStores = stores.filter((s) => {
    const nb = normalizeText(s.brand?.name ?? '');
    const nn = normalizeText(s.name);
    return nb === 'u' || nb.includes('super u') || nb.includes('hyper u') || nb.includes('u express')
        || nn.includes('super u') || nn.includes('hyper u') || nn.includes('u express');
  });

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`MAGASINS BANNIÈRE « U » : ${uStores.length}`);
  console.log('══════════════════════════════════════════════════════════════');
  for (const s of uStores) {
    // Incohérence utile à voir : normalizedName stocké ≠ normalizeText(name) ?
    const recalced = normalizeText(s.name);
    const flag = recalced !== s.normalizedName ? '  ⚠ normalizedName incohérent' : '';
    console.log(
      `   - store=${s.id}` +
      ` | deal=${s.deal?.id ?? 'AUCUN'}` +
      ` | enseigne=${JSON.stringify(s.brand?.name ?? null)}` +
      ` | name=${JSON.stringify(s.name)}` +
      ` | normalizedName=${JSON.stringify(s.normalizedName)}` +
      ` | city=${JSON.stringify(s.city)}` +
      ` | dedupKey=${JSON.stringify(s.deduplicationKey)}` +
      flag,
    );
  }

  console.log('\nTerminé (aucune modification effectuée).\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
