// src/app/api/campaigns/unsubscribe/[token]/route.ts
//
//   GET  /api/campaigns/unsubscribe/<token>   → page de confirmation
//   POST /api/campaigns/unsubscribe/<token>   → en-tête List-Unsubscribe-Post
//
// Désinscription en un clic, depuis le lien en bas des emails. Le jeton est
// l'identifiant de suivi du message : il ne dit rien du lead et ne sert qu'à
// ça.
//
// Effet : le lead est marqué désinscrit et TOUTES ses séquences en cours
// s'arrêtent — pas seulement celle de l'email cliqué. Il ne sera plus jamais
// inscrit dans une campagne (cf. enrollLeads).

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

async function unsubscribe(token: string): Promise<{ ok: boolean; email?: string }> {
  const message = await prisma.campaignMessage.findUnique({
    where: { trackingId: token },
    select: { leadId: true, campaignId: true, lead: { select: { email: true, unsubscribedAt: true } } },
  });
  if (!message) return { ok: false };

  if (!message.lead.unsubscribedAt) {
    const now = new Date();
    await prisma.lead.update({
      where: { id: message.leadId },
      data: { status: 'unsubscribed', statusAt: now, unsubscribedAt: now },
    });
    await prisma.campaignEnrollment.updateMany({
      where: { leadId: message.leadId, status: { in: ['active', 'sending', 'paused'] } },
      data: { status: 'stopped', stopReason: 'unsubscribed', nextSendAt: null, finishedAt: now },
    });
    await prisma.leadEvent.create({
      data: {
        leadId: message.leadId,
        type: 'unsubscribed',
        label: 'Désinscription demandée depuis un email',
        payload: { campaignId: message.campaignId },
      },
    });
  }

  return { ok: true, email: message.lead.email };
}

function page(title: string, text: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8" />`
    + `<meta name="viewport" content="width=device-width,initial-scale=1" />`
    + `<title>${title}</title></head>`
    + `<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;`
    + `background:#f8fafc;color:#0f172a;display:flex;align-items:center;`
    + `justify-content:center;height:100vh;margin:0">`
    + `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;`
    + `padding:32px 36px;max-width:440px;text-align:center">`
    + `<div style="font-size:17px;font-weight:700;margin-bottom:8px">${title}</div>`
    + `<div style="font-size:14px;color:#475569;line-height:1.5">${text}</div>`
    + `</div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const result = await unsubscribe(params.token);
  return result.ok
    ? page('Vous êtes désinscrit', `L'adresse ${result.email} ne recevra plus aucun email de notre part.`)
    : page('Lien expiré', "Ce lien de désinscription n'est plus valide. Répondez simplement à l'email pour nous le signaler.");
}

/** Désinscription en un clic des clients mail (RFC 8058). */
export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  const result = await unsubscribe(params.token);
  return NextResponse.json({ ok: result.ok }, { status: result.ok ? 200 : 404 });
}
