import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isProductSupabaseConfigured } from '@/lib/demoOrganization';
import { fetchOrganizationRecruitment, matchDealOrganization } from '@/lib/recruitment';

// Données de recrutement d'une affaire : Offres de l'Organization produit
// (créée en « Démo prévue ») + candidats envoyés pour chacune. Lecture seule.
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
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
      return NextResponse.json({ configured, organizationId: deal.supabaseOrganizationId, offers: [] });
    }

    // Rattachement à la volée : si le deal n'a pas encore d'Organization, on la
    // retrouve par nom (« Enseigne Nom-magasin ») et on la persiste sur le deal.
    let organizationId = deal.supabaseOrganizationId;
    if (!organizationId) {
      const match = await matchDealOrganization({
        brandName: deal.store?.brand?.name,
        storeName: deal.store?.name,
        city: deal.store?.city,
      });
      if (match.organizationId) {
        organizationId = match.organizationId;
        await prisma.deal.update({
          where: { id: params.id },
          data: { supabaseOrganizationId: organizationId },
        });
      }
    }

    if (!organizationId) {
      return NextResponse.json({ configured: true, organizationId: null, offers: [] });
    }

    const offers = await fetchOrganizationRecruitment(organizationId);
    return NextResponse.json({ configured: true, organizationId, offers });
  } catch (err) {
    console.error('Recruitment fetch error:', err);
    return NextResponse.json(
      { error: 'Erreur lors de la récupération du recrutement' },
      { status: 500 },
    );
  }
}
