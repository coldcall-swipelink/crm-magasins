// Synchronisation du schéma de la base au moment du build (déploiement).
//
// Pourquoi : le pipeline ne poussait jamais les évolutions de schéma vers la
// base (le build se limitait à `prisma generate`). Une colonne ajoutée dans
// schema.prisma mais jamais propagée à la base provoquait des erreurs P2022
// (« column ... does not exist ») en production.
//
// Sécurité : on lance `prisma db push` SANS `--accept-data-loss`. Prisma
// applique donc uniquement les changements additifs (ajout de colonnes/tables)
// et REFUSE toute opération destructrice (suppression de colonne/table) en
// faisant échouer le build — jamais de perte de données silencieuse.
//
// Neon : les migrations/`db push` doivent passer par la connexion DIRECTE
// (non-pooler), car le pooler PgBouncer ne supporte pas les verrous de session
// utilisés par Prisma. On dérive donc l'URL directe depuis DATABASE_URL.
import { execSync } from 'node:child_process';

const url = process.env.DATABASE_URL;

if (!url) {
  console.warn('[db-sync] DATABASE_URL absente — db push ignoré.');
  process.exit(0);
}

// Neon : `...-pooler.<region>...` (pooler) -> `...<region>...` (direct).
const directUrl = url.replace('-pooler.', '.');

console.log('[db-sync] prisma db push (connexion directe, additif uniquement)…');
try {
  execSync('prisma db push --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: directUrl },
  });
  console.log('[db-sync] Schéma synchronisé ✅');
} catch {
  console.error('[db-sync] Échec de la synchronisation du schéma — build interrompu.');
  process.exit(1);
}
