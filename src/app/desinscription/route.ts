// GET / POST /desinscription?t=<jeton>
//
// Désinscription du pilote, appelée depuis le pied du mail et par l'en-tête
// List-Unsubscribe.
//
// Deux chemins, un seul effet :
//   • GET  — le directeur a cliqué « Se désinscrire » : on révoque et on le lui
//            dit sur une page ;
//   • POST — Gmail ou Outlook a actionné leur bouton natif (List-Unsubscribe-Post,
//            « One-Click ») : on révoque et on répond 200, sans rien afficher.
//
// Révoquer coupe tout d'un coup : le lien du parcours cesse d'ouvrir, et les
// rappels comme les relances s'arrêtent, puisqu'ils partent tous de
// l'invitation. Un jeton déjà révoqué répond la même chose — se désinscrire
// deux fois ne doit pas produire une erreur.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPvToken, looksLikePvToken } from '@/lib/pv/token';
import { escapeHtml } from '@/lib/pv/templates';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Révoque l'invitation et note la demande sur l'affaire. Vrai si trouvée. */
async function unsubscribe(token: string | null): Promise<boolean> {
  if (!token || !looksLikePvToken(token)) return false;

  const invite = await prisma.pvInvite.findUnique({
    where: { tokenHash: hashPvToken(token) },
    select: { id: true, dealId: true, revokedAt: true },
  });
  if (!invite) return false;
  if (invite.revokedAt) return true;

  await prisma.$transaction(async tx => {
    await tx.pvInvite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
    await tx.note.create({
      data: {
        dealId: invite.dealId,
        content:
          'Désinscription demandée depuis le mail « 2 CV de bouchers ». '
          + 'Lien du parcours révoqué, rappels et relances arrêtés.',
        authorName: 'Swipelink',
      },
    });
  });
  return true;
}

function page(titre: string, message: string, status: number): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(titre)} – Swipelink</title>
<style>
  html,body{margin:0;background:#F3F5FD;color:#0B0B3B;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;line-height:1.5}
  .wrap{max-width:480px;margin:0 auto;padding:64px 20px}
  .card{background:#fff;border:1px solid #E9ECF8;border-radius:20px;padding:32px;
    box-shadow:0 1px 2px rgba(11,11,59,.04),0 8px 24px rgba(11,11,59,.06)}
  h1{margin:0 0 12px;font-size:22px;line-height:1.25}
  p{margin:0;color:#3A3F66}
</style>
</head>
<body>
  <main class="wrap">
    <div class="card">
      <h1>${escapeHtml(titre)}</h1>
      <p>${escapeHtml(message)}</p>
    </div>
  </main>
</body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const ok = await unsubscribe(req.nextUrl.searchParams.get('t'));
    return ok
      ? page('C’est fait', 'Vous ne recevrez plus de message à propos de cette offre.', 200)
      : page('Lien inconnu', 'Ce lien de désinscription n’est pas reconnu.', 404);
  } catch (err) {
    console.error('[GET /desinscription]', err);
    return page('Erreur', 'La désinscription n’a pas pu aboutir. Écrivez-nous à hugo@swipelink.fr.', 500);
  }
}

/** Bouton natif « Se désabonner » de Gmail / Outlook (One-Click, RFC 8058). */
export async function POST(req: NextRequest) {
  try {
    await unsubscribe(req.nextUrl.searchParams.get('t'));
  } catch (err) {
    console.error('[POST /desinscription]', err);
  }
  // Toujours 200 : la messagerie n'attend qu'un accusé de réception.
  return new NextResponse(null, { status: 200 });
}
