import { NextRequest, NextResponse } from 'next/server';
import {
  createDemoOrganizationRecords,
  isProductSupabaseConfigured,
  buildOrganizationName,
  getOrganizationLogo,
} from '@/lib/demoOrganization';

// Route de TEST (temporaire) : crée une Organization dans la base PRODUIT
// Supabase avec exactement la même logique que « Démo prévue » / le bouton
// « Créer l'Organization dans Supabase » (Organization + Organization_to_plan +
// Recruiter, nom = enseigne + nom du magasin, logo déduit) — MAIS sans aucun
// accès à la base CRM (Neon). Permet de valider la connexion Supabase staging
// indépendamment de Neon.
//
// Usage :
//   /api/admin/test-create-org?token=sync-crm-2026&brand=Intermarché&store=Noyelles-sous-Lens
//
// À retirer une fois la vérification faite.
export const dynamic = 'force-dynamic';

const TOKEN = 'sync-crm-2026';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  if (params.get('token') !== TOKEN) {
    return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  }

  if (!isProductSupabaseConfigured()) {
    return NextResponse.json(
      {
        error:
          'Intégration Supabase produit non configurée (SUPABASE_PRODUCT_URL / SUPABASE_PRODUCT_SERVICE_ROLE_KEY manquants sur cet environnement).',
      },
      { status: 400 },
    );
  }

  // Données de test (surchargeables via l'URL). Valeurs par défaut = un magasin
  // fictif reconnaissable dans le dashboard Supabase.
  const brandName = params.get('brand') ?? 'Intermarché';
  const storeName = params.get('store') ?? `TEST ${new Date().toISOString()}`;
  const city = params.get('city') ?? '';

  try {
    const result = await createDemoOrganizationRecords({ brandName, storeName, city });
    return NextResponse.json({
      ok: true,
      created: {
        organizationId: result.organizationId,
        organizationName: result.organizationName,
      },
      // Récapitulatif de la logique appliquée (pour vérification visuelle).
      logic: {
        nameFrom: 'enseigne + nom du magasin',
        computedName: buildOrganizationName(brandName, storeName),
        computedLogo: getOrganizationLogo(brandName),
        note: 'contact_email et siret volontairement non renseignés',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
