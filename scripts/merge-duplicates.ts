// scripts/merge-duplicates.ts
//
// Fusionne les magasins/affaires en DOUBLON (même nom normalisé) en un seul,
// pour repartir sur une base propre après le bug de duplication Super U/Hyper U.
//
// SÉCURITÉ :
//   • DRY-RUN par défaut : le script n'écrit RIEN, il affiche seulement ce
//     qu'il ferait. Ajoute --apply pour exécuter réellement.
//   • Chaque fusion de groupe est faite dans une transaction.
//   • Le magasin CONSERVÉ (« primaire ») est celui qui porte déjà une affaire,
//     puis le plus ancien — donc l'historique manuel est préservé, et seuls les
//     doublons créés par l'import sont absorbés.
//
// FORTEMENT RECOMMANDÉ : fais une sauvegarde de la base avant --apply.
//
// Lancement :
//   Aperçu :   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/merge-duplicates.ts
//   Exécuter : npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/merge-duplicates.ts --apply

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

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
      deal: { select: { id: true } },
    },
  });

  // Regroupe par nom normalisé recalculé (indépendant des valeurs stockées).
  const groups = new Map<string, typeof stores>();
  for (const s of stores) {
    const key = normalizeText(s.name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const dupGroups = Array.from(groups.entries()).filter(([, arr]) => arr.length > 1);

  console.log(APPLY
    ? '*** MODE APPLICATION — modifications RÉELLES ***'
    : '*** DRY-RUN — aucune écriture (ajoute --apply pour exécuter) ***');
  console.log(`${dupGroups.length} groupe(s) de doublons détecté(s).\n`);

  let merged = 0;
  let skipped = 0;

  for (const [key, arr] of dupGroups) {
    // Primaire = celui qui a une affaire, puis le plus ancien.
    const sorted = [...arr].sort(
      (a, b) => (b.deal ? 1 : 0) - (a.deal ? 1 : 0) || a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const primary = sorted[0];
    const secondaries = sorted.slice(1);

    console.log(`▸ « ${key} » — primaire store=${primary.id} deal=${primary.deal?.id ?? 'AUCUN'} enseigne=${JSON.stringify(primary.brand?.name ?? null)}`);

    if (!primary.deal) {
      console.log('   ⚠ le primaire n\'a pas d\'affaire → groupe IGNORÉ (à traiter manuellement)\n');
      skipped++;
      continue;
    }
    const primaryDealId = primary.deal.id;

    for (const sec of secondaries) {
      console.log(`   - absorbe store=${sec.id} deal=${sec.deal?.id ?? 'AUCUN'} enseigne=${JSON.stringify(sec.brand?.name ?? null)} city=${JSON.stringify(sec.city)}`);
      merged++;
      if (!APPLY) continue;

      const secDealId = sec.deal?.id;
      await prisma.$transaction(async (tx) => {
        if (secDealId) {
          // Déplace les données rattachées à l'affaire secondaire vers la primaire.
          // (fingerprint des offres inclut l'ancien storeId → pas de collision.)
          await tx.jobOffer.updateMany({ where: { dealId: secDealId }, data: { dealId: primaryDealId, storeId: primary.id } });
          await tx.note.updateMany({ where: { dealId: secDealId }, data: { dealId: primaryDealId } });
          await tx.action.updateMany({ where: { dealId: secDealId }, data: { dealId: primaryDealId } });
          await tx.importRow.updateMany({ where: { dealId: secDealId }, data: { dealId: primaryDealId } });
          // Rattache les éventuels sous-deals de l'affaire secondaire à la primaire.
          await tx.deal.updateMany({ where: { parentDealId: secDealId }, data: { parentDealId: primaryDealId } });
          // Supprime l'affaire secondaire (les join-tables restantes sont en
          // cascade ; pour un doublon d'import elles sont vides).
          await tx.deal.delete({ where: { id: secDealId } });
        }
        // Rapatrie ce qui pointe encore vers le magasin secondaire, puis le supprime.
        await tx.jobOffer.updateMany({ where: { storeId: sec.id }, data: { storeId: primary.id } });
        await tx.importRow.updateMany({ where: { storeId: sec.id }, data: { storeId: primary.id } });
        await tx.store.delete({ where: { id: sec.id } });
      });
    }
    console.log('');
  }

  console.log(`Terminé. ${APPLY ? merged + ' doublon(s) fusionné(s)' : merged + ' fusion(s) prévue(s)'}, ${skipped} groupe(s) ignoré(s).`);
  if (!APPLY && merged >= 0) {
    console.log('\nAperçu uniquement — relance avec --apply pour appliquer (après sauvegarde de la base).');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
