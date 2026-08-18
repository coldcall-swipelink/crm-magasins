// src/app/api/payment-links/route.ts
//
// Paramétrage des liens de paiement (écran Paramètres › Liens de paiement).
//
//   GET → le plan tarifaire complet (les 42 cases, vides comprises), la liste
//         des liens spéciaux, et tous les liens Stripe actifs pour alimenter
//         les listes déroulantes d'attribution.
//   PUT → enregistre les attributions en un seul appel. Le front envoie l'état
//         complet du plan ; une case sans lien est effacée. Enregistrement en
//         bloc et en transaction : le plan est cohérent ou il ne change pas.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isStripeConfigured } from '@/lib/stripe';
import { getPaymentLinkCatalog } from '@/lib/paymentLinkCatalog';
import { isKnownSlotKey } from '@/lib/paymentLinkSlots';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: 'Intégration Stripe non configurée (STRIPE_SECRET_KEY manquant).' },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await getPaymentLinkCatalog());
  } catch (err) {
    console.error('Payment links GET error:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Erreur lors de la lecture des liens de paiement.' },
      { status: 502 },
    );
  }
}

interface IncomingAssignment {
  slotKey?: unknown;
  stripeLinkId?: unknown;
}

export async function PUT(req: NextRequest) {
  let body: { assignments?: IncomingAssignment[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 });
  }

  const assignments = Array.isArray(body.assignments) ? body.assignments : null;
  if (!assignments) return NextResponse.json({ error: 'assignments requis' }, { status: 400 });

  // Une clé inconnue signalerait un plan désynchronisé entre le front et
  // paymentLinkSlots.ts : on refuse plutôt que d'écrire une case fantôme.
  const unknown = assignments.filter(a => !isKnownSlotKey(a.slotKey));
  if (unknown.length > 0) {
    return NextResponse.json({ error: 'Une ou plusieurs cases sont inconnues du plan tarifaire.' }, { status: 400 });
  }

  const toSet: { slotKey: string; stripeLinkId: string }[] = [];
  const toClear: string[] = [];
  for (const a of assignments) {
    const slotKey = a.slotKey as string;
    const linkId = typeof a.stripeLinkId === 'string' ? a.stripeLinkId.trim() : '';
    if (!linkId) { toClear.push(slotKey); continue; }
    if (!linkId.startsWith('plink_')) {
      return NextResponse.json({ error: `Identifiant de lien invalide : ${linkId}` }, { status: 400 });
    }
    toSet.push({ slotKey, stripeLinkId: linkId });
  }

  try {
    await prisma.$transaction([
      ...(toClear.length ? [prisma.paymentLinkSlot.deleteMany({ where: { slotKey: { in: toClear } } })] : []),
      ...toSet.map(r =>
        prisma.paymentLinkSlot.upsert({
          where: { slotKey: r.slotKey },
          create: r,
          update: { stripeLinkId: r.stripeLinkId },
        }),
      ),
    ]);
  } catch (err) {
    console.error('Payment links PUT error:', err);
    return NextResponse.json(
      { error: `Enregistrement impossible : ${(err as Error).message || 'erreur inconnue'}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ assigned: toSet.length, cleared: toClear.length });
}
