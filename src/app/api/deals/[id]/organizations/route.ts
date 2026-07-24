import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isProductSupabaseConfigured } from '@/lib/demoOrganization';
import { fetchOrganizationById } from '@/lib/recruitment';

// Gestion manuelle des Organizations rattachées à un deal (ajout / retrait).
// Utilisé quand l'auto-rattachement par nom échoue, ou pour lier plusieurs orgs.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isProductSupabaseConfigured()) {
      return NextResponse.json({ error: 'Intégration Supabase produit non configurée' }, { status: 400 });
    }
    const body = await req.json();
    const organizationId = typeof body?.organizationId === 'string' ? body.organizationId.trim() : '';
    // primary=true → devient l'organisation PRINCIPALE (figée sur le deal via
    // supabaseOrganizationId). Sinon → organisation secondaire (DealOrganization).
    const primary = body?.primary === true;
    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId requis' }, { status: 400 });
    }

    const deal = await prisma.deal.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!deal) return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });

    // Validation : l'organisation doit exister côté produit. La recherche se fait
    // par id (pas par nom) : un renommage côté Supabase ne l'invalide donc pas.
    const org = await fetchOrganizationById(organizationId);
    if (!org) {
      return NextResponse.json({ error: 'Organisation introuvable dans Supabase (id invalide ?)' }, { status: 404 });
    }

    if (primary) {
      // On fige l'id sur le deal comme organisation principale. S'il figurait
      // parmi les secondaires, on l'en retire pour éviter le doublon.
      await prisma.dealOrganization.deleteMany({ where: { dealId: params.id, organizationId } });
      await prisma.deal.update({
        where: { id: params.id },
        data: { supabaseOrganizationId: organizationId, supabaseOrgManual: true },
      });
    } else {
      await prisma.dealOrganization.upsert({
        where: { dealId_organizationId: { dealId: params.id, organizationId } },
        create: { dealId: params.id, organizationId },
        update: {},
      });
      // L'utilisateur gère désormais manuellement : on coupe l'auto-rattachement.
      await prisma.deal.update({ where: { id: params.id }, data: { supabaseOrgManual: true } });
    }

    return NextResponse.json({ ok: true, organizationId, organizationName: org.name, primary });
  } catch (err) {
    console.error('Deal organizations POST error:', err);
    return NextResponse.json({ error: 'Erreur lors de l\'ajout (migration db-sync effectuée ?)' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const organizationId = typeof body?.organizationId === 'string' ? body.organizationId.trim() : '';
    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId requis' }, { status: 400 });
    }

    await prisma.dealOrganization.deleteMany({ where: { dealId: params.id, organizationId } });

    // Retire aussi l'org « primaire » (provisioning) si c'est celle-ci, et
    // verrouille l'auto-rattachement pour ne pas la re-lier automatiquement.
    const deal = await prisma.deal.findUnique({ where: { id: params.id }, select: { supabaseOrganizationId: true } });
    await prisma.deal.update({
      where: { id: params.id },
      data: {
        supabaseOrgManual: true,
        ...(deal?.supabaseOrganizationId === organizationId ? { supabaseOrganizationId: null } : {}),
      },
    });

    return NextResponse.json({ ok: true, organizationId });
  } catch (err) {
    console.error('Deal organizations DELETE error:', err);
    return NextResponse.json({ error: 'Erreur lors du retrait' }, { status: 500 });
  }
}
