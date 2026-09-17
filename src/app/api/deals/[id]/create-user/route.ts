import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isProductSupabaseConfigured } from '@/lib/demoOrganization';
import { createProductUserRecords, isValidEmail } from '@/lib/productUser';

// Création à la demande d'un utilisateur de la base PRODUIT Supabase pour une
// affaire : compte Auth (mot de passe « 00000000 ») + ligne User + ligne
// Recruiter rattachée à l'organisation du deal.
//
// Cette route ne fait que l'orchestration côté CRM — lire l'organisation
// rattachée à l'affaire — et délègue les écritures Supabase au module pur
// productUser.ts. Elle n'écrit rien dans la base du CRM.
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

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: 'Email invalide' }, { status: 400 });
    }
    if (!firstName) return NextResponse.json({ error: 'Prénom requis' }, { status: 400 });
    if (!lastName) return NextResponse.json({ error: 'Nom requis' }, { status: 400 });
    if (!companyPosition) return NextResponse.json({ error: 'Poste requis' }, { status: 400 });

    // L'organisation du deal, telle qu'elle est rattachée à l'affaire.
    const deal = await prisma.deal.findUnique({
      where: { id: params.id },
      select: { id: true, supabaseOrganizationId: true },
    });
    if (!deal) return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });

    const organizationId = deal.supabaseOrganizationId;
    if (!organizationId) {
      return NextResponse.json(
        { error: 'Aucune organisation Supabase rattachée à cette affaire' },
        { status: 400 },
      );
    }

    const result = await createProductUserRecords({
      organizationId,
      email,
      firstName,
      lastName,
      companyPosition,
    });

    return NextResponse.json({ ok: true, organizationId, userId: result.userId });
  } catch (err) {
    console.error('Create product user error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erreur lors de la création du user' },
      { status: 500 },
    );
  }
}
