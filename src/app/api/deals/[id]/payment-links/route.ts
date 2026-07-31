// src/app/api/deals/[id]/payment-links/route.ts
//
// Liste les liens de paiement Stripe ACTIFS pour une affaire, en construisant
// pour chacun l'URL finale avec `?client_reference_id=<ref>` :
//   - <ref> = group_id de l'Organization si elle est rattachée à un groupe
//   - <ref> = organization_id sinon
//
// L'organization_id provient du deal (supabaseOrganizationId), avec repli sur la
// première organisation secondaire rattachée (DealOrganization). Une affaire SANS
// organisation rattachée est bloquée (code NO_ORG) : on n'envoie jamais un lien
// de paiement sans référence, sinon le paiement ne serait pas rattaché.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isProductSupabaseConfigured } from '@/lib/demoOrganization';
import { resolveClientReference } from '@/lib/recruitment';
import { isStripeConfigured, fetchActivePaymentLinks, appendClientReferenceId } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: 'Intégration Stripe non configurée (STRIPE_SECRET_KEY manquant).' },
        { status: 400 },
      );
    }
    if (!isProductSupabaseConfigured()) {
      return NextResponse.json(
        { error: 'Intégration Supabase produit non configurée.' },
        { status: 400 },
      );
    }

    const deal = await prisma.deal.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        supabaseOrganizationId: true,
        organizationLinks: { select: { organizationId: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!deal) return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });

    // Organisation de référence : principale (provisioning) ou, à défaut, la
    // première organisation secondaire rattachée manuellement.
    const organizationId = deal.supabaseOrganizationId || deal.organizationLinks[0]?.organizationId || null;
    if (!organizationId) {
      return NextResponse.json(
        {
          error: 'Cette affaire n\'est rattachée à aucune organisation Supabase. Rattachez d\'abord une organisation (onglet Recrutement).',
          code: 'NO_ORG',
        },
        { status: 400 },
      );
    }

    const reference = await resolveClientReference(organizationId);
    if (!reference) {
      return NextResponse.json(
        {
          error: 'Organisation introuvable dans Supabase (organization_id invalide ?).',
          code: 'ORG_NOT_FOUND',
        },
        { status: 400 },
      );
    }

    let links;
    try {
      links = await fetchActivePaymentLinks();
    } catch (stripeErr) {
      // Erreur côté Stripe (clé invalide, permissions manquantes, etc.) : on
      // remonte le message réel pour faciliter le diagnostic côté CRM.
      console.error('Stripe payment-links error:', stripeErr);
      return NextResponse.json(
        { error: (stripeErr as Error).message || 'Erreur Stripe inconnue.', code: 'STRIPE_ERROR' },
        { status: 502 },
      );
    }

    return NextResponse.json({
      organizationId,
      reference,
      links: links.map(l => ({
        id: l.id,
        label: l.label,
        // URL finale prête à copier / envoyer, avec le client_reference_id ajouté.
        url: appendClientReferenceId(l.url, reference.referenceId),
      })),
    });
  } catch (err) {
    console.error('Deal payment-links GET error:', err);
    return NextResponse.json(
      { error: 'Erreur lors de la récupération des liens de paiement Stripe.' },
      { status: 500 },
    );
  }
}
