import { NextRequest, NextResponse } from 'next/server';
import { createOrganizationForDeal } from '@/lib/supabaseProvisioning';

// Création manuelle de l'Organization produit (Supabase) pour une affaire qui
// n'en a pas encore, via le bouton « Créer l'Organization dans Supabase ».
// Réutilise la même logique que le passage en « Démo prévue ».
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await createOrganizationForDeal(params.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('Provision organization error:', err);
    const message = err instanceof Error ? err.message : 'Erreur lors de la création';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
