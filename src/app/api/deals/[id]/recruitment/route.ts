import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isProductSupabaseConfigured } from '@/lib/demoOrganization';
import { fetchOrganizationsRecruitment, matchDealOrganization } from '@/lib/recruitment';

// Données de recrutement d'une affaire : Offres des Organizations produit
// rattachées (auto en « Démo prévue » ou manuelles) + candidats likés envoyés.
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Champs « historiques » uniquement (fonctionne même avant db-sync).
    const deal = await prisma.deal.findUnique({
      where: { id: params.id },
      select: {
        supabaseOrganizationId: true,
        store: { select: { name: true, city: true, brand: { select: { name: true } } } },
      },
    });
    if (!deal) return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });

    const configured = isProductSupabaseConfigured();
    if (!configured) {
      return NextResponse.json({ configured, organizations: [], calledCandidateIds: [] });
    }

    // Liens manuels + flag (tolère l'absence de table/colonne avant db-sync).
    let manual = false;
    let manualOrgIds: string[] = [];
    try {
      const extra = await prisma.deal.findUnique({
        where: { id: params.id },
        select: { supabaseOrgManual: true, organizationLinks: { select: { organizationId: true } } },
      });
      manual = extra?.supabaseOrgManual ?? false;
      manualOrgIds = extra?.organizationLinks?.map((o) => o.organizationId) ?? [];
    } catch {
      // Avant migration : on reste sur l'ancien comportement (mono-org auto).
    }

    // Rattachement automatique à la volée, sauf si géré manuellement.
    let primaryOrgId = deal.supabaseOrganizationId;
    if (!primaryOrgId && !manual) {
      const match = await matchDealOrganization({
        brandName: deal.store?.brand?.name,
        storeName: deal.store?.name,
        city: deal.store?.city,
      });
      if (match.organizationId) {
        primaryOrgId = match.organizationId;
        await prisma.deal.update({
          where: { id: params.id },
          data: { supabaseOrganizationId: primaryOrgId },
        });
      }
    }

    const orgIds = Array.from(new Set([primaryOrgId, ...manualOrgIds].filter((x): x is string => Boolean(x))));
    const organizations = orgIds.length ? await fetchOrganizationsRecruitment(orgIds) : [];
    const calledCandidateIds = await getCalledCandidateIds(params.id);

    return NextResponse.json({ configured: true, organizations, calledCandidateIds });
  } catch (err) {
    console.error('Recruitment fetch error:', err);
    return NextResponse.json(
      { error: 'Erreur lors de la récupération du recrutement' },
      { status: 500 },
    );
  }
}

/**
 * Ids des candidats déjà appelés pour ce deal (cases cochées). Tolère l'absence
 * de la table CandidateCall (avant exécution de db-sync) en renvoyant [].
 */
async function getCalledCandidateIds(dealId: string): Promise<string[]> {
  try {
    const calls = await prisma.candidateCall.findMany({
      where: { dealId },
      select: { candidateId: true },
    });
    return calls.map((c) => c.candidateId);
  } catch (err) {
    console.error('CandidateCall lookup error (table manquante ?):', err);
    return [];
  }
}
