// scripts/test-google.ts
//
// Script de diagnostic de la connexion Google Calendar + Meet.
// Vérifie, dans l'ordre :
//   1. le refresh du token OAuth ;
//   2. la création d'un espace Google Meet « Ouvert à tous » (accessType OPEN) ;
//   3. la création d'un événement Google Calendar de test (sans envoyer d'invitation).
//
// Il N'ENVOIE PAS d'email (sendUpdates=none) et n'invite personne : c'est juste
// un test de connexion. Pense à supprimer l'événement de test créé à la fin
// (le script affiche son lien).
//
// Utilisation :
//   1. Mets les 3 secrets dans un fichier .env ou .env.local à la racine
//      (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN),
//      ou récupère-les depuis Vercel :  vercel env pull .env.local
//   2. Lance :  npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/test-google.ts

import { readFileSync } from 'fs';
import { join } from 'path';

// Mini-chargeur de .env (évite d'ajouter une dépendance). Charge .env.local puis .env.
function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      const content = readFileSync(join(process.cwd(), file), 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const key = m[1];
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = val;
      }
    } catch {
      /* fichier absent, on ignore */
    }
  }
}

async function main() {
  loadEnv();

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  const timeZone = process.env.GOOGLE_MEET_TIMEZONE || 'Europe/Paris';

  if (!clientId || !clientSecret || !refreshToken) {
    console.error('❌ Variables manquantes. Il faut GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET et GOOGLE_REFRESH_TOKEN.');
    process.exit(1);
  }

  // 1. Refresh du token ----------------------------------------------------
  console.log('① Refresh du token OAuth…');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!tokenRes.ok) {
    console.error(`❌ Échec refresh token (${tokenRes.status}):`, await tokenRes.text());
    process.exit(1);
  }
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };
  console.log('   ✅ Token obtenu.\n');

  // 2. Espace Meet « Ouvert à tous » --------------------------------------
  console.log('② Création d\'un espace Google Meet (accessType OPEN)…');
  const spaceRes = await fetch('https://meet.googleapis.com/v2/spaces', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: { accessType: 'OPEN' } }),
  });
  if (!spaceRes.ok) {
    console.error(`❌ Échec création espace Meet (${spaceRes.status}):`, await spaceRes.text());
    console.error('   → Vérifie que « Google Meet API » est activée et que le scope meetings.space.created est présent.');
    process.exit(1);
  }
  const space = (await spaceRes.json()) as { meetingUri: string; meetingCode: string; config?: { accessType?: string } };
  console.log(`   ✅ Meet créé : ${space.meetingUri}`);
  console.log(`   → accessType renvoyé par Google : ${space.config?.accessType ?? '(non renvoyé)'}`);
  if (space.config?.accessType !== 'OPEN') {
    console.log('   ⚠️  accessType n\'est pas "OPEN" → typique d\'un compte gmail perso (non Workspace).');
  }
  console.log('');

  // 3. Événement Calendar de test (sans invitation) -----------------------
  console.log('③ Création d\'un événement Calendar de test (aucune invitation envoyée)…');
  const start = new Date(Date.now() + 24 * 3600 * 1000); // demain, même heure
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 19); // YYYY-MM-DDTHH:mm:ss
  const eventRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=none`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: '[TEST] Swipelink & Démo - Recrutements (à supprimer)',
        description: `Événement de test.\nLien Meet : ${space.meetingUri}`,
        location: space.meetingUri,
        start: { dateTime: fmt(start), timeZone },
        end: { dateTime: fmt(end), timeZone },
        conferenceData: {
          conferenceId: space.meetingCode,
          conferenceSolution: { key: { type: 'hangoutsMeet' }, name: 'Google Meet' },
          entryPoints: [{ entryPointType: 'video', uri: space.meetingUri }],
        },
      }),
    },
  );
  if (!eventRes.ok) {
    console.error(`❌ Échec création événement (${eventRes.status}):`, await eventRes.text());
    console.error('   → Vérifie que « Google Calendar API » est activée et que le scope calendar.events est présent.');
    process.exit(1);
  }
  const event = (await eventRes.json()) as { id: string; htmlLink: string };
  console.log('   ✅ Événement créé.');
  console.log(`   → À vérifier puis SUPPRIMER : ${event.htmlLink}`);
  console.log(`   → (event id: ${event.id})\n`);

  console.log('🎉 Connexion Google opérationnelle. Pense à supprimer l\'événement de test ci-dessus.');
}

main().catch((e) => {
  console.error('❌ Erreur inattendue :', e);
  process.exit(1);
});
