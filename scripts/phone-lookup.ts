// scripts/phone-lookup.ts
//
// Campagne de recherche automatique des numéros de téléphone des magasins.
// C'est l'outil à privilégier pour le PREMIER passage sur toute la base : il
// tourne sans limite de temps (contrairement à une route serveur) et affiche
// l'avancement en direct.
//
// Utilisation :
//   npm run phones:lookup                          # aperçu : ce qu'il y a à faire
//   npm run phones:lookup -- --run                 # lance la campagne
//   npm run phones:lookup -- --run --scope echecs  # relance les magasins non résolus
//   npm run phones:lookup -- --run --no-google     # sources gratuites uniquement
//
// Options :
//   --run          exécute réellement (sans lui, simple état des lieux)
//   --scope        nouveaux (défaut) | erreurs | echecs | tout
//   --limit        nombre maximum de magasins traités (défaut : tous)
//   --batch        taille d'un lot entre deux affichages d'avancement (défaut : 25)
//   --no-google    n'utilise que les sources gratuites (OpenStreetMap)
//   --all-stores   traite aussi les magasins sans affaire rattachée
//
// La campagne est REPRENABLE : chaque magasin traité est marqué en base, donc
// une interruption (Ctrl-C, coupure réseau) ne fait rien perdre — il suffit de
// relancer la même commande.
import { PrismaClient } from '@prisma/client';
import { runPhoneLookupBatch, phoneLookupStats, type BatchScope } from '../src/lib/phone/lookup';

const prisma = new PrismaClient();

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}
function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main() {
  const scopeArg = getArg('--scope');
  const scope: BatchScope =
    scopeArg === 'erreurs' || scopeArg === 'echecs' || scopeArg === 'tout'
      ? scopeArg
      : 'nouveaux';
  const dealsOnly = !hasFlag('--all-stores');
  const useGoogle = !hasFlag('--no-google');
  const batchSize = Number(getArg('--batch') || 25);
  const max = Number(getArg('--limit') || 0);

  const stats = await phoneLookupStats(prisma, dealsOnly);
  console.log('\n📞 Recherche automatique des numéros de magasins');
  console.log('─'.repeat(60));
  console.log(`Magasins concernés        : ${stats.total}`);
  console.log(`  • avec numéro           : ${stats.withPhone}`);
  console.log(`  • jamais cherchés       : ${stats.pending}`);
  console.log(`  • en attente de revue   : ${stats.toReview}`);
  console.log(`  • non résolus           : ${stats.notFound}`);
  console.log(`  • en erreur (à relancer): ${stats.errors}`);
  console.log(`Google Places             : ${stats.googleConfigured ? (useGoogle ? 'activé' : 'configuré mais désactivé (--no-google)') : 'non configuré (sources gratuites seules)'}`);
  console.log('─'.repeat(60));

  if (!hasFlag('--run')) {
    console.log('\nAperçu uniquement. Ajoutez --run pour lancer la campagne.\n');
    return;
  }

  console.log(`\nPérimètre : ${scope} — lots de ${batchSize} magasins.`);
  console.log('Interruption possible à tout moment (Ctrl-C) : la campagne reprend où elle s\'est arrêtée.\n');

  const totals = { processed: 0, found: 0, toReview: 0, notFound: 0, errors: 0 };
  const startedAt = Date.now();
  // Un magasin déjà examiné depuis le début de cette campagne en sort, quel
  // qu'ait été le résultat. Sans cela, les périmètres de relance boucleraient :
  // un magasin repris sans succès conserve son statut, donc reste dans le
  // périmètre et revient en tête du lot suivant (cf. même garde côté interface).
  const notTouchedSince = new Date();

  for (;;) {
    const remainingBudget = max > 0 ? max - totals.processed : Infinity;
    if (remainingBudget <= 0) break;

    const report = await runPhoneLookupBatch(prisma, {
      limit: Math.min(batchSize, remainingBudget),
      // En ligne de commande, aucune plateforme ne vient couper l'exécution :
      // c'est le nombre de magasins qui borne le lot, pas le temps. Le budget
      // est donc volontairement hors d'atteinte.
      maxMillis: 6 * 60 * 60 * 1000,
      scope,
      useGoogle,
      dealsOnly,
      notTouchedSince,
    });

    totals.processed += report.processed;
    totals.found += report.found;
    totals.toReview += report.toReview;
    totals.notFound += report.notFound;
    totals.errors += report.errors;

    for (const r of report.results) {
      const icon = r.status === 'trouve' ? '✅' : r.status === 'a_verifier' ? '🟠' : r.status === 'erreur' ? '❌' : '⚪';
      const detail = r.phone
        ? `${r.phone} (${r.source})`
        : r.status === 'a_verifier'
          ? `${r.candidates.length} proposition(s) à valider`
          : r.error || 'aucun numéro trouvé';
      console.log(`${icon} ${r.label} → ${detail}`);
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `\n   ↳ ${totals.processed} traités en ${elapsed}s — ` +
      `${totals.found} trouvés, ${totals.toReview} à valider, ${totals.notFound} non résolus. ` +
      `Reste ${report.remaining} magasin(s) dans le périmètre.\n`,
    );

    if (report.stopped) {
      console.error(`\n⛔ Campagne interrompue : ${report.stopped}\n`);
      break;
    }
    if (report.processed === 0 || report.remaining === 0) break;
  }

  console.log('─'.repeat(60));
  console.log(`Terminé : ${totals.found} numéros enregistrés, ${totals.toReview} à valider dans Paramètres → Numéros de téléphone, ${totals.notFound} non résolus.`);
  if (totals.errors) console.log(`${totals.errors} magasin(s) en erreur — relancez avec --scope erreurs.`);
  console.log('');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
