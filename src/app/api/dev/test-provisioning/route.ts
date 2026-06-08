// src/app/api/dev/test-provisioning/route.ts
//
// Route de TEST du provisioning Supabase (Organization + plan + Recruiter).
//
// Elle crée des données FICTIVES directement dans la base produit Supabase,
// SANS lire la base Neon du CRM (aucun appel Prisma). Pratique pour valider
// l'intégration sur un environnement de dev où Neon n'est pas branché.
//
// ⚠️ Désactivée par défaut. Pour l'activer, définir ENABLE_DEV_TEST_ROUTES=true
// (à NE PAS faire en production). Nécessite aussi SUPABASE_PRODUCT_URL et
// SUPABASE_PRODUCT_SERVICE_ROLE_KEY.
//
// Utilisation :
//   GET  /api/dev/test-provisioning                 → données fictives par défaut
//   POST /api/dev/test-provisioning  { brandName, storeName, city, ... }

import { NextRequest, NextResponse } from 'next/server';
import {
  createDemoOrganizationRecords,
  isProductSupabaseConfigured,
  type DemoOrganizationInput,
} from '@/lib/demoOrganization';

export const dynamic = 'force-dynamic';

async function handle(input: DemoOrganizationInput) {
  // Parsing robuste : on tolère les guillemets/espaces et plusieurs formes.
  const rawFlag = process.env.ENABLE_DEV_TEST_ROUTES;
  const flag = (rawFlag ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase();
  const enabled = flag === 'true' || flag === '1' || flag === 'yes';

  if (!enabled) {
    // Diagnostic (aucun secret exposé) pour comprendre pourquoi c'est désactivé.
    return NextResponse.json(
      {
        error: 'Route de test désactivée',
        diagnostic: {
          enableFlagPresent: rawFlag !== undefined,
          enableFlagValue: rawFlag ?? null,
          supabaseUrlPresent: Boolean(process.env.SUPABASE_PRODUCT_URL),
          supabaseKeyPresent: Boolean(process.env.SUPABASE_PRODUCT_SERVICE_ROLE_KEY),
          hint:
            rawFlag === undefined
              ? "La variable n'atteint pas ce déploiement : vérifie le scope (Preview) et REDÉPLOIE."
              : "La variable est présente mais ≠ true : retire d'éventuels guillemets/espaces.",
        },
      },
      { status: 404 },
    );
  }
  if (!isProductSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'SUPABASE_PRODUCT_URL / SUPABASE_PRODUCT_SERVICE_ROLE_KEY non configurés' },
      { status: 400 },
    );
  }

  try {
    const result = await createDemoOrganizationRecords(input);
    return NextResponse.json({ ok: true, input, result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

const FALLBACK: DemoOrganizationInput = {
  brandName: 'Enseigne Test',
  storeName: 'Magasin Test',
  city: 'Paris',
  contactEmail: 'test@example.com',
  phoneNumber: '0102030405',
  siret: '12345678900011',
};

export async function GET() {
  return handle(FALLBACK);
}

export async function POST(req: NextRequest) {
  let body: Partial<DemoOrganizationInput> = {};
  try {
    body = await req.json();
  } catch {
    // corps vide → on garde les valeurs par défaut
  }
  return handle({ ...FALLBACK, ...body });
}
