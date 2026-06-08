// src/lib/supabaseProvisioning.ts
//
// Provisioning de la base produit Supabase quand une affaire passe dans la
// colonne « Démo prévue ».
//
// En plus de l'invitation Google Meet (voir googleCalendar.ts), on crée dans
// la base PRODUIT (projet Supabase distinct de celui du CRM) :
//   1. une Organization        (l'enseigne du magasin : « Enseigne — Ville »)
//   2. un Organization_to_plan (rattachement au plan Standard)
//   3. un Recruiter            (admin, rattaché à un user fixe)
//
// On utilise l'API REST PostgREST de Supabase avec la clé service_role
// (inserts côté serveur, contourne le RLS). Aucune dépendance npm requise —
// on reste sur fetch, comme googleCalendar.ts et les webhooks n8n.
//
// Idempotent : l'id de l'Organization créée est stocké sur le Deal
// (supabaseOrganizationId). Si déjà présent, on ne refait rien.
//
// Variables d'environnement requises (voir .env.example) :
//   SUPABASE_PRODUCT_URL                  (ex : https://xxxx.supabase.co)
//   SUPABASE_PRODUCT_SERVICE_ROLE_KEY     (clé service_role / secret)
// Optionnelles :
//   SUPABASE_PRODUCT_PLAN_ID              (défaut : plan Standard)
//   SUPABASE_PRODUCT_RECRUITER_USER_ID    (défaut : user fixe)
//   SUPABASE_PRODUCT_SMARTLINK_CREDITS    (défaut : 3)

import { prisma } from '@/lib/prisma';

// Valeurs par défaut (staging). Surchageables via variables d'environnement.
const DEFAULT_PLAN_ID = 'de1d4cbf-5a51-4de5-9aeb-df8119a65489'; // plan « Standard »
const DEFAULT_RECRUITER_USER_ID = 'e05bd473-a010-4658-b0b7-cfd5e344b919';
const DEFAULT_SMARTLINK_CREDITS = 3;

/** Indique si l'intégration est configurée. Sinon on no-op silencieusement. */
export function isProductSupabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_PRODUCT_URL &&
      process.env.SUPABASE_PRODUCT_SERVICE_ROLE_KEY,
  );
}

/** Insère une ligne via l'API REST PostgREST et renvoie la ligne créée. */
async function insertRow<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const baseUrl = (process.env.SUPABASE_PRODUCT_URL as string).replace(/\/$/, '');
  const key = process.env.SUPABASE_PRODUCT_SERVICE_ROLE_KEY as string;

  const res = await fetch(`${baseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Insert Supabase « ${table} » échoué (${res.status}) : ${detail}`);
  }

  const data = (await res.json()) as T[];
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Insert Supabase « ${table} » : réponse inattendue`);
  }
  return data[0];
}

/** Construit le nom de l'Organization : « Enseigne — Ville ». */
function buildOrganizationName(
  brandName: string | undefined,
  storeName: string,
  city: string,
): string {
  const base = brandName?.trim() || storeName?.trim() || 'Organisation';
  const c = city?.trim();
  return c ? `${base} — ${c}` : base;
}

/**
 * Crée Organization + Organization_to_plan + Recruiter dans la base produit
 * Supabase pour une affaire passée en « Démo prévue ».
 *
 * Idempotent : ne fait rien si le deal possède déjà un supabaseOrganizationId
 * ou si l'intégration n'est pas configurée.
 */
export async function provisionDemoOrganization(dealId: string): Promise<void> {
  if (!isProductSupabaseConfigured()) return;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { store: { include: { brand: true } }, column: true },
  });
  if (!deal) return;
  if (deal.column?.title !== 'Démo prévue') return;
  if (deal.supabaseOrganizationId) return; // déjà provisionné → on ne refait rien

  const planId = process.env.SUPABASE_PRODUCT_PLAN_ID || DEFAULT_PLAN_ID;
  const recruiterUserId =
    process.env.SUPABASE_PRODUCT_RECRUITER_USER_ID || DEFAULT_RECRUITER_USER_ID;
  const smartlinkCredits =
    Number(process.env.SUPABASE_PRODUCT_SMARTLINK_CREDITS) || DEFAULT_SMARTLINK_CREDITS;

  const orgName = buildOrganizationName(
    deal.store.brand?.name,
    deal.store.name,
    deal.store.city,
  );

  // 1. Organization
  const org = await insertRow<{ id: string }>('Organization', {
    name: orgName,
    contact_email: deal.dealEmail || null,
    phone_number: deal.contactCalling || deal.store.phone || null,
    siret: deal.store.siret || null,
  });

  // On mémorise immédiatement l'id sur le deal : garantit l'idempotence même
  // si une étape suivante échoue (on ne recréera pas d'Organization en double).
  await prisma.deal.update({
    where: { id: deal.id },
    data: { supabaseOrganizationId: org.id },
  });

  // 2. Organization_to_plan (rattachement au plan Standard)
  await insertRow('Organization_to_plan', {
    organization_id: org.id,
    plan_id: planId,
    started_at: new Date().toISOString(),
    smartlink_credit_balance: smartlinkCredits,
  });

  // 3. Recruiter (admin, rattaché au user fixe)
  await insertRow('Recruiter', {
    user_id: recruiterUserId,
    organization_id: org.id,
    is_admin: true,
  });
}
