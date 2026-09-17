import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isProductSupabaseConfigured } from '@/lib/demoOrganization';
import { matchDealOrganization } from '@/lib/recruitment';
import { createProductUserRecords, isValidEmail } from '@/lib/productUser';

// Création à la demande d'un utilisateur de la base PRODUIT Supabase pour une
// affaire : compte Auth (mot de passe « 00000000 ») + ligne User + ligne
// Recruiter rattachée à l'organisation du deal.
//
// Cette route ne fait que l'orchestration côté CRM — résoudre l'organisation
// rattachée à l'affaire — et délègue les écritures Supabase au module pur
// productUser.ts.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isProductSupabaseConfigured()) {
      return NextResponse.json(
        { error: 'Intégration Supabase produit non configurée' },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const firstName = typeof body?.firstName === 'string' ? body.firstName.trim() : '';
    const lastName = typeof body?.lastName === 'string' ? body.lastName.trim() : '';
    const companyPosition = typeof body?.companyPosition === 'string' ? body.companyPosition.trim() : '';
    // Recruiter administrateur par défaut : c'est le compte du magasin.
    const isAdmin = body?.isAdmin !== false;

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: 'Email invalide' }, { status: 400 });
    }
    if (!firstName) return NextResponse.json({ error: 'Prénom requis' }, { status: 400 });
    if (!lastName) return NextResponse.json({ error: 'Nom requis' }, { status: 400 });
    if (!companyPosition) return NextResponse.json({ error: 'Poste requis' }, { status: 400 });

    const deal = await prisma.deal.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        supabaseOrganizationId: true,
        store: { select: { name: true, city: true, brand: { select: { name: true } } } },
      },
    });
    if (!deal) return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });

    // Organisation du deal : celle figée dessus, sinon on tente la même
    // correspondance par nom que l'onglet « Recrutement », et on la mémorise.
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
          where: { id: deal.id },
          data: { supabaseOrganizationId: organizationId },
        });
      }
    }
    if (!organizationId) {
      return NextResponse.json(
        { error: 'Aucune organisation Supabase rattachée à cette affaire — créez-la ou renseignez son organization_id d\'abord' },
        { status: 400 },
      );
    }

    const result = await createProductUserRecords({
      organizationId,
      email,
      firstName,
      lastName,
      companyPosition,
      isAdmin,
    });

    return NextResponse.json({ ok: true, organizationId, ...result });
  } catch (err) {
    console.error('Create product user error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erreur lors de la création du user' },
      { status: 500 },
    );
  }
}
