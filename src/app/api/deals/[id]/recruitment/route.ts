import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isProductSupabaseConfigured } from '@/lib/demoOrganization';
import { fetchOrganizationRecruitment } from '@/lib/recruitment';

// Données de recrutement d'une affaire : Offres de l'Organization produit
// (créée en « Démo prévue ») + candidats envoyés pour chacune. Lecture seule.
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: params.id },
      select: { supabaseOrganizationId: true },
    });
    if (!deal) return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });

    const configured = isProductSupabaseConfigured();

    // Pas encore d'Organization (deal jamais passé en « Démo prévue ») ou
    // intégration non configurée : on renvoie une liste vide explicite.
    if (!deal.supabaseOrganizationId || !configured) {
      return NextResponse.json({
        configured,
        organizationId: deal.supabaseOrganizationId,
        offers: [],
      });
    }

    const offers = await fetchOrganizationRecruitment(deal.supabaseOrganizationId);
    return NextResponse.json({
      configured: true,
      organizationId: deal.supabaseOrganizationId,
      offers,
    });
  } catch (err) {
    console.error('Recruitment fetch error:', err);
    return NextResponse.json(
      { error: 'Erreur lors de la récupération du recrutement' },
      { status: 500 },
    );
  }
}
