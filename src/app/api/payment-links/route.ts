// src/app/api/payment-links/route.ts
//
// Paramétrage CRM des liens de paiement (écran Paramètres › Liens de paiement).
//
//   GET  → le catalogue complet : tous les liens Stripe actifs, enrichis de leur
//          paramétrage CRM (catégorie, libellé personnalisé, ordre, masquage),
//          liens masqués COMPRIS — c'est l'écran qui décide quoi montrer.
//   PUT  → enregistre le paramétrage en un seul appel. Le front envoie l'état
//          complet des deux listes ; on réécrit les lignes correspondantes.
//          Enregistrement en bloc (et non par ligne) parce qu'un réordonnancement
//          touche par nature plusieurs liens à la fois : une seule transaction,
//          pas d'état intermédiaire incohérent.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isStripeConfigured } from '@/lib/stripe';
import { getPaymentLinkCatalog, normalizeCategory } from '@/lib/paymentLinkCatalog';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: 'Intégration Stripe non configurée (STRIPE_SECRET_KEY manquant).' },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json({ links: await getPaymentLinkCatalog() });
  } catch (err) {
    console.error('Payment links GET error:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Erreur lors de la lecture des liens de paiement.' },
      { status: 502 },
    );
  }
}

interface IncomingItem {
  stripeLinkId?: unknown;
  category?: unknown;
  displayName?: unknown;
  position?: unknown;
  hidden?: unknown;
}

export async function PUT(req: NextRequest) {
  let body: { items?: IncomingItem[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : null;
  if (!items) return NextResponse.json({ error: 'items requis' }, { status: 400 });

  // Nettoyage : on ne garde que des lignes exploitables, et on borne les
  // libellés pour ne pas stocker un copier-coller accidentel de 10 000 signes.
  const rows = items
    .filter(i => typeof i.stripeLinkId === 'string' && i.stripeLinkId.startsWith('plink_'))
    .map(i => ({
      stripeLinkId: i.stripeLinkId as string,
      category: normalizeCategory(i.category),
      displayName: typeof i.displayName === 'string' ? i.displayName.trim().slice(0, 120) : '',
      position: Number.isFinite(Number(i.position)) ? Math.trunc(Number(i.position)) : 0,
      hidden: Boolean(i.hidden),
    }));

  if (rows.length !== items.length) {
    return NextResponse.json({ error: 'Un ou plusieurs identifiants de lien sont invalides.' }, { status: 400 });
  }

  try {
    await prisma.$transaction(
      rows.map(r =>
        prisma.paymentLinkConfig.upsert({
          where: { stripeLinkId: r.stripeLinkId },
          create: r,
          update: { category: r.category, displayName: r.displayName, position: r.position, hidden: r.hidden },
        }),
      ),
    );
  } catch (err) {
    console.error('Payment links PUT error:', err);
    return NextResponse.json(
      { error: `Enregistrement impossible : ${(err as Error).message || 'erreur inconnue'}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ saved: rows.length });
}
