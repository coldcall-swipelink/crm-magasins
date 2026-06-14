import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isProductSupabaseConfigured } from '@/lib/demoOrganization';
import {
  buildDealOrganizationName,
  fetchAllOrganizations,
  buildOrganizationIndex,
  matchDealOrganizationInIndex,
} from '@/lib/recruitment';

// Le matching se fait en mémoire (toutes les Organizations récupérées une seule
// fois), donc aucune requête Supabase par deal : indispensable pour rester sous
// la limite de temps des fonctions, même avec beaucoup d'affaires.
export const maxDuration = 60;

// Backfill ponctuel : rattache les affaires existantes à leur Organization
// produit (Supabase) en retrouvant celle-ci par son nom « Enseigne Nom-magasin »
// (repli « Enseigne Ville »). Protégé par token.
//
//   GET /api/admin/link-organizations?token=sync-crm-2026             -> dry-run (aucune écriture)
//   GET /api/admin/link-organizations?token=sync-crm-2026&apply=true  -> persiste les correspondances uniques
//
// Par défaut, ne traite que les affaires sans supabaseOrganizationId. Ajouter
// &all=true pour ré-évaluer aussi celles déjà rattachées (sans les écraser).
export const dynamic = 'force-dynamic';

const TOKEN = 'sync-crm-2026';

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== TOKEN) {
    return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  }
  if (!isProductSupabaseConfigured()) {
    return NextResponse.json({ error: 'Intégration Supabase produit non configurée' }, { status: 400 });
  }

  const apply = req.nextUrl.searchParams.get('apply') === 'true';
  const includeAll = req.nextUrl.searchParams.get('all') === 'true';

  const [deals, organizations] = await Promise.all([
    prisma.deal.findMany({
      where: includeAll ? {} : { supabaseOrganizationId: null },
      select: {
        id: true,
        supabaseOrganizationId: true,
        store: { select: { name: true, city: true, brand: { select: { name: true } } } },
      },
    }),
    fetchAllOrganizations(),
  ]);

  const index = buildOrganizationIndex(organizations);

  const summary = {
    total: deals.length,
    organizations: organizations.length,
    matched: 0,
    ambiguous: 0,
    notFound: 0,
    alreadyLinked: 0,
    updated: 0,
  };
  const results: Array<Record<string, unknown>> = [];

  for (const deal of deals) {
    if (deal.supabaseOrganizationId) {
      summary.alreadyLinked++;
      if (!includeAll) continue;
    }

    const expectedName = buildDealOrganizationName(deal.store?.brand?.name, deal.store?.name);
    const match = matchDealOrganizationInIndex(index, {
      brandName: deal.store?.brand?.name,
      storeName: deal.store?.name,
      city: deal.store?.city,
    });

    if (match.status === 'matched') summary.matched++;
    else if (match.status === 'ambiguous') summary.ambiguous++;
    else summary.notFound++;

    let updated = false;
    // On ne (ré)écrit que les affaires non encore rattachées avec un match unique.
    if (apply && match.organizationId && !deal.supabaseOrganizationId) {
      await prisma.deal.update({
        where: { id: deal.id },
        data: { supabaseOrganizationId: match.organizationId },
      });
      updated = true;
      summary.updated++;
    }

    results.push({
      dealId: deal.id,
      store: deal.store?.name ?? null,
      brand: deal.store?.brand?.name ?? null,
      expectedName,
      status: match.status,
      matchedBy: match.matchedBy,
      matchedName: match.matchedName,
      organizationId: match.organizationId,
      alreadyLinked: Boolean(deal.supabaseOrganizationId),
      updated,
    });
  }

  return NextResponse.json({ apply, includeAll, summary, results });
}
