// scripts/google-auth.ts
//
// Refait le parcours d'autorisation Google et produit un GOOGLE_REFRESH_TOKEN
// neuf, portant TOUTES les autorisations dont le CRM a besoin :
//
//   • calendar          → lire l'agenda (bouton « Afficher les dispos ») ET
//                         créer/modifier les événements de démo ;
//   • meetings.space.created → créer les visios Meet « Ouvertes à tous ».
//
// Le jeton actuel n'ayant qu'une partie de ces autorisations, l'agenda a
// longtemps refusé la lecture (« ACCESS_TOKEN_SCOPE_INSUFFICIENT »). Ce script
// rejoue le consentement une bonne fois pour toutes.
//
// UTILISATION (sur VOTRE poste, pas sur le serveur : il faut un navigateur)
//
//   1. Récupérer les secrets existants :  vercel env pull .env.local
//      (ou créer un .env.local avec GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET)
//   2. npm run google:auth
//   3. Ouvrir l'adresse affichée, choisir le compte, accepter.
//   4. Recopier le GOOGLE_REFRESH_TOKEN affiché dans Vercel
//      (Settings → Environment Variables), puis redéployer.
//
// Le script ne modifie aucun fichier et n'écrit rien dans votre agenda : il
// vérifie juste, à la fin, que le nouveau jeton lit bien le calendrier.

import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';

/** Autorisations demandées. « calendar » couvre à la fois la lecture des
 *  disponibilités et l'écriture des événements de démo : une seule case à
 *  cocher pour l'utilisateur, et plus aucun 403 de portée insuffisante. */
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/meetings.space.created',
];

const PORT = Number(process.env.GOOGLE_AUTH_PORT) || 5555;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;

// Mini-chargeur de .env (même principe que scripts/test-google.ts : pas de
// dépendance supplémentaire pour un script lancé à la main).
function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(join(process.cwd(), file), 'utf8').split('\n')) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!(m[1] in process.env)) process.env[m[1]] = val;
      }
    } catch { /* fichier absent : on ignore */ }
  }
}

/** Page renvoyée dans le navigateur à la fin du parcours. */
function pageRetour(ok: boolean, detail = ''): string {
  return `<!doctype html><meta charset="utf-8"><title>CRM — autorisation Google</title>
<body style="font-family:system-ui,sans-serif;background:#f8fafc;margin:0;display:flex;align-items:center;justify-content:center;height:100vh">
<div style="background:#fff;border-radius:14px;padding:32px 40px;box-shadow:0 20px 60px rgba(15,23,42,.15);max-width:520px">
<div style="font-size:32px">${ok ? '✅' : '❌'}</div>
<h1 style="font-size:19px;margin:10px 0 6px">${ok ? 'Autorisation accordée' : 'Autorisation refusée'}</h1>
<p style="color:#475569;font-size:14px;line-height:1.5;margin:0">${
    ok
      ? 'Vous pouvez fermer cet onglet et revenir au terminal : le jeton s’y affiche.'
      : `Rien n’a été modifié. Détail : ${detail}`
  }</p></div></body>`;
}

/** Attend le retour de Google sur le port local et renvoie le code d'autorisation. */
function attendreLeCode(state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${PORT}`);
      if (url.pathname !== '/oauth2callback') { res.statusCode = 404; return res.end(); }

      const code = url.searchParams.get('code');
      const erreur = url.searchParams.get('error');

      // L'état protège d'un retour qui ne viendrait pas de la demande en cours.
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(pageRetour(false, 'état inattendu'));
        server.close();
        return reject(new Error('État OAuth inattendu — recommencez le parcours.'));
      }

      res.writeHead(erreur || !code ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pageRetour(!erreur && !!code, erreur || 'aucun code reçu'));
      server.close();

      if (erreur || !code) return reject(new Error(erreur || 'Google n’a renvoyé aucun code.'));
      resolve(code);
    });

    server.on('error', (e: NodeJS.ErrnoException) => {
      reject(new Error(
        e.code === 'EADDRINUSE'
          ? `Le port ${PORT} est déjà pris. Relancez avec un autre port :\n   GOOGLE_AUTH_PORT=5566 npm run google:auth`
          : String(e),
      ));
    });
    server.listen(PORT);
  });
}

async function main() {
  loadEnv();

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      '❌ GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET sont introuvables.\n' +
      '   Récupérez-les depuis Vercel :  vercel env pull .env.local\n' +
      '   (ou créez un .env.local à la racine avec ces deux lignes).',
    );
    process.exit(1);
  }

  const state = Math.random().toString(36).slice(2);
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('redirect_uri', REDIRECT);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', SCOPES.join(' '));
  // offline + consent : sans ces deux-là, Google ne renvoie PAS de refresh
  // token quand le compte a déjà autorisé l'application par le passé.
  auth.searchParams.set('access_type', 'offline');
  auth.searchParams.set('prompt', 'consent');
  auth.searchParams.set('state', state);

  console.log('\n① Ouvrez cette adresse dans votre navigateur :\n');
  console.log('   ' + auth.toString() + '\n');
  console.log(`   (le script écoute sur ${REDIRECT} et attend votre retour…)\n`);
  console.log('   Si Google répond « redirect_uri_mismatch », ajoutez cette URI');
  console.log('   dans la console Google Cloud → API et services → Identifiants →');
  console.log(`   votre ID client OAuth → URI de redirection autorisés :\n     ${REDIRECT}\n`);

  const code = await attendreLeCode(state);

  console.log('② Échange du code contre un jeton…');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: REDIRECT, grant_type: 'authorization_code',
    }).toString(),
  });
  const data = await res.json() as {
    refresh_token?: string; access_token?: string; scope?: string; error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    console.error(`❌ Échange refusé (${res.status}) : ${data.error_description || JSON.stringify(data)}`);
    process.exit(1);
  }
  if (!data.refresh_token) {
    console.error(
      '❌ Google n’a pas renvoyé de refresh token.\n' +
      '   Retirez l’accès du CRM sur https://myaccount.google.com/permissions,\n' +
      '   puis relancez le script.',
    );
    process.exit(1);
  }

  // Vérification immédiate : le jeton lit-il vraiment l'agenda ? Mieux vaut le
  // savoir ici que devant l'écran rouge de la pop-up des dispos.
  console.log('③ Vérification de la lecture de l’agenda…');
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  const debut = new Date();
  const fin = new Date(debut.getTime() + 7 * 24 * 3600 * 1000);
  const check = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events` +
    `?timeMin=${debut.toISOString()}&timeMax=${fin.toISOString()}&singleEvents=true&maxResults=10`,
    { headers: { Authorization: `Bearer ${data.access_token}` } },
  );
  if (check.ok) {
    const items = (await check.json() as { items?: unknown[] }).items ?? [];
    console.log(`   ✅ Agenda « ${calendarId} » lisible — ${items.length} événement(s) sur 7 jours.`);
  } else {
    console.log(`   ⚠️  Lecture refusée (${check.status}) : ${await check.text()}`);
  }

  console.log('\n④ À recopier dans Vercel (Settings → Environment Variables),');
  console.log('   puis redéployer :\n');
  console.log('GOOGLE_REFRESH_TOKEN=' + data.refresh_token + '\n');
  console.log('   Autorisations obtenues :');
  for (const s of (data.scope || '').split(' ').filter(Boolean)) console.log('     • ' + s);
  console.log('\n   Ce jeton reste valable tant que vous ne révoquez pas l’accès.');
  console.log('   Ne le commitez pas : il ouvre votre agenda.\n');
}

main().catch(err => { console.error('\n❌ ' + (err instanceof Error ? err.message : String(err)) + '\n'); process.exit(1); });
