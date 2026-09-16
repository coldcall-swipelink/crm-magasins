// POST /api/pv/invites?token=<CRON_SECRET>
//
// Génère un jeton par magasin et envoie le mail « 2 CV de bouchers ».
//
//   { "dealIds": ["..."], "dryRun": true }
//
// `dryRun` rend le mail sans l'envoyer : c'est l'aperçu, celui qu'on regarde
// avant d'écrire à un vrai directeur.
//
// Un magasin, un jeton : générer une nouvelle invitation révoque la précédente,
// pour qu'un même magasin n'ait jamais deux liens valables en circulation.
//
// GET /api/pv/invites?token=…&dealId=… — aperçu d'un seul magasin, pratique
// depuis un navigateur.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAuthorizedPvAdmin } from '@/lib/pv/auth';
import { createPvInvite } from '@/lib/pv/invites';
import { ensureStoreGeo } from '@/lib/pv/geo';
import { findReferences } from '@/lib/pv/references';
import { invitationLink, renderInvitation, sendPvMail } from '@/lib/pv/mail';
import { pvConsultant } from '@/lib/pv/config';
import { countButcherProfiles } from '@/lib/pv/profiles';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Prénom du contact, à partir des champs de la fiche affaire. */
function prenomContact(deal: { directeur: string; contactCalling: string }): string {
  const source = (deal.directeur || deal.contactCalling || '').trim();
  if (!source) return '';
  const premier = source.split(/\s+/)[0];
  // « M. Dupont » : le premier mot n'est pas un prénom.
  if (/^(m|mr|mme|mlle|monsieur|madame|dr)\.?$/i.test(premier)) return '';
  return premier;
}

/** « 12 mars » — date de publication de l'offre, telle qu'affichée en bas du mail. */
function datePublication(publishedAt: string, secours: Date): string {
  const brut = publishedAt?.trim();
  const date = brut && !Number.isNaN(new Date(brut).getTime()) ? new Date(brut) : secours;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(date);
}

async function prepare(dealId: string) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      store: { include: { brand: true } },
      jobOffers: { orderBy: { lastSeenAt: 'desc' }, take: 1 },
    },
  });
  if (!deal) return { error: `Affaire ${dealId} introuvable` } as const;

  const destinataire = (deal.dealEmail || deal.store.email || '').trim();
  if (!destinataire) return { error: `Affaire ${dealId} : aucune adresse e-mail` } as const;

  const geo = await ensureStoreGeo(deal.store);
  const references = await findReferences({
    dealId: deal.id,
    brandId: deal.store.brandId,
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null,
  });

  const enseigne = deal.store.brand?.name?.trim() || '';
  const nom = deal.store.name?.trim() || '';
  const magasin = enseigne && !nom.toLowerCase().includes(enseigne.toLowerCase())
    ? `${enseigne} ${nom}`.trim()
    : nom || enseigne;
  const offre = deal.jobOffers[0];

  return {
    deal,
    destinataire,
    references,
    // Le nombre annoncé, calculé à l'identique de ce que fera l'invitation :
    // l'aperçu montre donc exactement le mail que recevra le directeur.
    nbProfils: countButcherProfiles({
      storeId: deal.store.id,
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
    }),
    contexte: {
      magasin,
      enseigne: enseigne || magasin,
      ville: deal.store.city || '',
      prenom: prenomContact(deal),
      intituleOffre: offre?.jobTitle || offre?.title || 'Boucher (H/F)',
      datePublication: datePublication(offre?.publishedAt || '', offre?.firstSeenAt || deal.createdAt),
    },
  } as const;
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedPvAdmin(req)) {
    return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  }

  let body: { dealIds?: unknown; dryRun?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Corps de requête illisible' }, { status: 400 });
  }

  const dealIds = Array.isArray(body.dealIds) ? body.dealIds.filter(id => typeof id === 'string') : [];
  if (dealIds.length === 0) {
    return NextResponse.json({ error: 'dealIds manquant' }, { status: 400 });
  }
  const dryRun = body.dryRun === true;

  const resultats: Array<Record<string, unknown>> = [];
  for (const dealId of dealIds as string[]) {
    try {
      const prep = await prepare(dealId);
      if ('error' in prep) {
        resultats.push({ dealId, ok: false, error: prep.error });
        continue;
      }

      if (dryRun) {
        // Aperçu : ni jeton créé, ni mail envoyé. Le lien porte un jeton
        // factice, uniquement pour voir à quoi ressemble le bouton.
        const rendu = renderInvitation({
          ...prep.contexte,
          nbProfils: prep.nbProfils,
          references: prep.references,
          token: 'apercu',
        });
        resultats.push({
          dealId,
          ok: true,
          dryRun: true,
          to: prep.destinataire,
          subject: rendu.subject,
          references: prep.references.length,
          html: rendu.html,
        });
        continue;
      }

      const invite = await createPvInvite(dealId);
      const rendu = renderInvitation({
        ...prep.contexte,
        nbProfils: invite.nbProfils,
        references: prep.references,
        token: invite.token,
      });

      const envoi = await sendPvMail(
        {
          to: prep.destinataire,
          subject: rendu.subject,
          html: rendu.html,
          text: rendu.text,
          token: invite.token,
          dealId,
        },
        // Message froid : il part de la boîte de campagne (domaine dédié,
        // préchauffage, cadence), pas du canal transactionnel.
        { preferMailbox: true },
      );

      if (envoi.ok) {
        await prisma.pvInvite.update({
          where: { id: invite.id },
          data: { sentAt: new Date(), messageId: envoi.messageId },
        });
      }

      resultats.push({
        dealId,
        ok: envoi.ok,
        via: envoi.via,
        to: prep.destinataire,
        lien: invitationLink(invite.token),
        nbProfils: invite.nbProfils,
        references: prep.references.length,
        expiresAt: invite.expiresAt,
        error: envoi.error,
      });
    } catch (err) {
      console.error('[POST /api/pv/invites]', dealId, err);
      resultats.push({ dealId, ok: false, error: (err as Error).message });
    }
  }

  return NextResponse.json({
    consultant: pvConsultant().prenom,
    envoyes: resultats.filter(r => r.ok && !r.dryRun).length,
    echecs: resultats.filter(r => !r.ok).length,
    resultats,
  });
}

/** Aperçu d'un magasin, à ouvrir dans un navigateur. */
export async function GET(req: NextRequest) {
  if (!isAuthorizedPvAdmin(req)) {
    return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  }
  const dealId = req.nextUrl.searchParams.get('dealId') || '';
  const prep = await prepare(dealId);
  if ('error' in prep) return NextResponse.json({ error: prep.error }, { status: 404 });

  const rendu = renderInvitation({
    ...prep.contexte,
    nbProfils: prep.nbProfils,
    references: prep.references,
    token: 'apercu',
  });
  return new NextResponse(rendu.html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
