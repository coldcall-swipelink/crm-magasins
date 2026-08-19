import { NextRequest, NextResponse } from 'next/server';
import { provisionDemoOrganization } from '@/lib/supabaseProvisioning';

// Création à la demande de l'Organization produit Supabase (+ plan + Recruiter)
// pour une affaire, SANS avoir à la faire passer dans la colonne « Démo prévue ».
//
// Même paramétrage que le provisioning automatique : on réutilise
// `provisionDemoOrganization`, en sautant uniquement le contrôle de colonne
// (`force`). L'opération reste idempotente : si l'affaire porte déjà un
// supabaseOrganizationId, rien n'est recréé.
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await provisionDemoOrganization(params.id, { force: true });

    switch (result.status) {
      case 'created':
        return NextResponse.json({
          ok: true,
          created: true,
          organizationId: result.organizationId,
          organizationName: result.organizationName,
        });
      case 'already_provisioned':
        return NextResponse.json({
          ok: true,
          created: false,
          organizationId: result.organizationId,
        });
      case 'not_configured':
        return NextResponse.json(
          { error: 'Intégration Supabase produit non configurée' },
          { status: 400 },
        );
      case 'deal_not_found':
        return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });
      default:
        // `wrong_column` est impossible ici (force: true) — filet de sécurité.
        return NextResponse.json({ error: 'Provisioning impossible' }, { status: 400 });
    }
  } catch (err) {
    console.error('Provision organization error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erreur lors de la création de l\'organisation' },
      { status: 500 },
    );
  }
}
