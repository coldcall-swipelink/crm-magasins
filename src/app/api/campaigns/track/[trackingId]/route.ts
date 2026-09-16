// src/app/api/campaigns/track/[trackingId]/route.ts
//
//   GET /api/campaigns/track/<trackingId>.gif
//
// Pixel de suivi d'ouverture. L'identifiant est propre au message (jamais son
// id de base) : l'URL ne révèle donc rien et ne permet rien d'autre que de
// marquer une ouverture.
//
// Limites assumées du procédé : une image bloquée ne compte pas l'ouverture,
// un pré-chargement (Apple Mail, proxy Gmail) la compte sans lecture. Le taux
// se lit comme une tendance. C'est pourquoi on garde aussi `openCount` : une
// ouverture unique ressemble souvent à un pré-chargement, plusieurs ouvertures
// espacées sont un vrai signal.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// GIF transparent de 1×1 pixel (43 octets).
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

export async function GET(_req: NextRequest, { params }: { params: { trackingId: string } }) {
  // L'URL porte « .gif » pour ressembler à une image ordinaire.
  const trackingId = params.trackingId.replace(/\.gif$/i, '');

  // Le pixel part toujours, quoi qu'il advienne de l'enregistrement : un
  // incident de base ne doit pas casser l'affichage de l'email.
  try {
    const message = await prisma.campaignMessage.findUnique({
      where: { trackingId },
      select: { id: true, leadId: true, openedAt: true, campaignId: true, stepPosition: true },
    });

    if (message) {
      await prisma.campaignMessage.update({
        where: { id: message.id },
        data: { openCount: { increment: 1 }, ...(message.openedAt ? {} : { openedAt: new Date() }) },
      });

      // Première ouverture seulement : sinon la frise du lead se remplirait
      // d'une ligne par rechargement de l'email.
      if (!message.openedAt) {
        await prisma.lead.update({
          where: { id: message.leadId },
          data: { lastOpenedAt: new Date() },
        });
        await prisma.leadEvent.create({
          data: {
            leadId: message.leadId,
            type: 'email_opened',
            label: `Email ouvert (étape ${message.stepPosition})`,
            payload: { campaignId: message.campaignId },
          },
        });
      }
    }
  } catch (err) {
    console.error('[campaigns/track]', err);
  }

  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(PIXEL.length),
      // Sans cela, le client mail met l'image en cache et la deuxième
      // ouverture ne se voit jamais.
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
    },
  });
}
