// Synchronisation du schéma de la base au moment du build (déploiement).
//
// Pourquoi : le pipeline ne poussait jamais les évolutions de schéma vers la
// base (le build se limitait à `prisma generate`). Une colonne ajoutée dans
// schema.prisma mais jamais propagée à la base provoquait des erreurs P2022
// (« column ... does not exist ») en production.
//
// Sécurité : on lance `prisma db push` SANS `--accept-data-loss`. Prisma
// applique donc uniquement les changements additifs (ajout de colonnes/tables)
// et REFUSE toute opération destructrice — jamais de perte de données.
//
// Robustesse : on essaie plusieurs formes d'URL (pooler tel quel, puis Neon
// direct), avec un timeout, et on NE FAIT JAMAIS échouer le build si la synchro
// ne passe pas (sinon un souci de connexion bloquerait tous les déploiements).
import { execSync } from 'node:child_process';

const url = process.env.DATABASE_URL;

if (!url) {
  console.warn('[db-sync] DATABASE_URL absente — db push ignoré, build poursuivi.');
  process.exit(0);
}

// Candidats d'URL à essayer dans l'ordre :
//  1) l'URL telle quelle (souvent le pooler — joignable depuis le runtime),
//  2) la connexion directe Neon (sans `-pooler`) en secours.
const candidates = [['URL fournie', url]];
const direct = url.replace('-pooler.', '.');
if (direct !== url) candidates.push(['connexion directe Neon', direct]);

let synced = false;
for (const [label, candidate] of candidates) {
  console.log(`[db-sync] tentative prisma db push via ${label}…`);
  try {
    execSync('prisma db push --skip-generate', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: candidate },
      timeout: 90_000,
    });
    console.log(`[db-sync] Schéma synchronisé via ${label} ✅`);
    synced = true;
    break;
  } catch {
    console.warn(`[db-sync] échec via ${label}, on tente la suite…`);
  }
}

if (!synced) {
  console.warn('[db-sync] ⚠️ Schéma NON synchronisé (base injoignable depuis le build ?). '
    + 'Build poursuivi quand même — à appliquer via `npx prisma db push` en local si besoin.');
}

// Jamais bloquant : le build continue dans tous les cas.
process.exit(0);
