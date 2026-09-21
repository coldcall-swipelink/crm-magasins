// GET /boucher?t=<jeton>
//
// La page du parcours, servie par le CRM lui-même — c'est elle que le bouton du
// mail ouvre, sur rdv.swipelink.fr/boucher.
//
// Trois choses se passent ici, et pas ailleurs :
//
//  1. LE JETON EST VÉRIFIÉ AVANT DE SERVIR QUOI QUE CE SOIT. Un jeton inconnu ou
//     expiré ne reçoit pas le parcours avec un bandeau d'erreur : il reçoit une
//     page d'explication, et RIEN d'autre — aucun nom de magasin, aucune
//     adresse, aucun créneau. « Aucune donnée affichée » est pris au mot.
//
//  2. LE MAGASIN, LE NOMBRE DE PROFILS ET LE PITCH SONT INJECTÉS DANS LE HTML.
//     La page sait les récupérer par /api/pv/context, mais l'attente se
//     verrait : le directeur ouvre le lien depuis sa boîte mail, souvent en 4G,
//     et doit lire le nom de SON magasin et pourquoi c'est gratuit tout de
//     suite. Les créneaux, eux, se chargent ensuite — ils ne sont utiles qu'au
//     quatrième écran.
//
//  3. CONFIG.API PASSE DE "" À "/api", ce qui fait sortir la page du mode démo.
//     Le fichier de src/pv-assets/ reste donc ouvrable tel quel dans un
//     navigateur, avec ses données fictives, pour travailler le design.

import { NextRequest, NextResponse } from 'next/server';
import { libelleMagasin } from '@/lib/pv/bookings';
import { rejectionMessage, resolvePvInvite } from '@/lib/pv/invites';
import { pitchFor, pitchHtml } from '@/lib/pv/pitch';
import { escapeHtml, googleTagHtml, parcoursTemplate, withGoogleTag } from '@/lib/pv/templates';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Page du parcours, personnalisée pour un magasin. */
function renderParcours(magasin: string, nbProfils: number, enseigne: string | null | undefined): string {
  let html = withGoogleTag(parcoursTemplate());

  // Sortie du mode démo : la page appelle le CRM sur le même domaine.
  html = html.replace('API: "",', 'API: "/api",');

  // Nom du magasin, dans le bandeau bleu.
  html = html.replace(
    /(<div class="store" id="ctx-mag">)[\s\S]*?(<\/div>)/,
    `$1${escapeHtml(magasin)}$2`,
  );

  // Nombre de profils : la page l'anime au chargement en partant de cette
  // valeur, puis la confirme avec celle de /api/pv/context — identique, donc
  // sans ressaut visible.
  html = html.replace(
    /(<span id="ctx-n" class="count-up">)\d+(<\/span>)/,
    `$1${nbProfils}$2`,
  );

  // Pitch « pourquoi c'est gratuit », selon l'enseigne : rendu ici pour que le
  // volet gauche soit complet dès le premier affichage.
  html = html.replace(
    /<!--\s*pitch:start\s*-->[\s\S]*?<!--\s*pitch:end\s*-->/,
    () => pitchHtml(pitchFor(enseigne)),
  );

  return html;
}

/** Page d'erreur : un message, un contact, aucune donnée. */
function renderErreur(message: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#1A1AD9">
<meta name="robots" content="noindex">
<title>Lien expiré – Swipelink</title>
${googleTagHtml()}
<style>
  html,body{margin:0;background:#F3F5FD;color:#0B0B3B;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;line-height:1.5}
  .wrap{max-width:480px;margin:0 auto;padding:64px 20px}
  .card{background:#fff;border:1px solid #E9ECF8;border-radius:20px;padding:32px;
    box-shadow:0 1px 2px rgba(11,11,59,.04),0 8px 24px rgba(11,11,59,.06)}
  h1{margin:0 0 12px;font-size:22px;line-height:1.25}
  p{margin:0 0 8px;color:#3A3F66}
  a{color:#1A1AD9;font-weight:600}
  .foot{margin-top:24px;text-align:center;font-size:13px;color:#8A90B3}
</style>
</head>
<body>
  <main class="wrap">
    <div class="card">
      <h1>Ce lien n'est plus valable</h1>
      <p>${escapeHtml(message)}</p>
    </div>
    <p class="foot">Swipelink SAS ·
      <a href="https://www.swipelink.fr/mentions-legales">Mentions légales</a>
    </p>
  </main>
</body>
</html>`;
}

function page(html: string, status: number): NextResponse {
  return new NextResponse(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Page propre à un magasin : ni CDN ni navigateur ne doivent la garder.
      'Cache-Control': 'private, no-store, max-age=0',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
      // Le jeton ne doit pas finir dans les résultats de recherche.
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export async function GET(req: NextRequest) {
  const lookup = await resolvePvInvite(req.nextUrl.searchParams.get('t'));
  if (!lookup.ok) {
    return page(renderErreur(rejectionMessage(lookup.reason)), 403);
  }

  try {
    const { invite } = lookup;
    return page(
      renderParcours(libelleMagasin(invite), invite.nbProfils, invite.deal.store.brand?.name),
      200,
    );
  } catch (err) {
    console.error('[GET /boucher]', err);
    return page(
      renderErreur("La page n'a pas pu s'afficher. Réessayez dans un instant."),
      500,
    );
  }
}
