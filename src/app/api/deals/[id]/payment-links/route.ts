// src/app/api/deals/[id]/payment-links/route.ts
//
// Liens de paiement disponibles pour une affaire, prêts à envoyer.
//
// Deux familles, issues du catalogue (src/lib/paymentLinkCatalog.ts) :
//   - `slots` : le plan tarifaire fixe (offre × jeu de tarifs × mode de paiement),
//     42 cases toujours renvoyées dans le même ordre, vides comprises — la fiche
//     affaire en fait ses trois listes déroulantes ;
//   - `specials` : les liens actifs n'occupant aucune case, créés pour un client.
//
// Chaque lien porte son URL finale, avec `?client_reference_id=<ref>` :
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
import { isStripeConfigured, appendClientReferenceId } from '@/lib/stripe';
import { getPaymentLinkCatalog, type CatalogLink } from '@/lib/paymentLinkCatalog';

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

    let catalog;
    try {
      catalog = await getPaymentLinkCatalog();
    } catch (stripeErr) {
      // Erreur côté Stripe (clé invalide, permissions manquantes, etc.) : on
      // remonte le message réel pour faciliter le diagnostic côté CRM.
      console.error('Stripe payment-links error:', stripeErr);
      return NextResponse.json(
        { error: (stripeErr as Error).message || 'Erreur Stripe inconnue.', code: 'STRIPE_ERROR' },
        { status: 502 },
      );
    }

    // L'URL finale (client_reference_id compris) est calculée ici, une fois :
    // le front n'a plus qu'à copier ce qu'on lui donne.
    const withUrl = (l: CatalogLink) => ({
      id: l.id,
      name: l.name,
      amountLabel: l.amountLabel,
      url: appendClientReferenceId(l.url, reference.referenceId),
    });

    return NextResponse.json({
      organizationId,
      reference,
      slots: catalog.slots.map(s => ({
        slotKey: s.slotKey,
        offerKey: s.offerKey,
        offerLabel: s.offerLabel,
        tariffKey: s.tariffKey,
        tariffLabel: s.tariffLabel,
        modeKey: s.modeKey,
        modeLabel: s.modeLabel,
        fullLabel: s.fullLabel,
        link: s.link ? withUrl(s.link) : null,
      })),
      specials: catalog.specials.map(withUrl),
    });
  } catch (err) {
    console.error('Deal payment-links GET error:', err);
    // On expose le message réel (Supabase, colonne manquante, etc.) pour le
    // diagnostic. Aucun secret n'y transite (ni clé Stripe ni clé Supabase).
    return NextResponse.json(
      { error: `Erreur lors de la récupération des liens de paiement : ${(err as Error).message || 'inconnue'}` },
      { status: 500 },
    );
  }
}
