// src/lib/demoOrganization.ts
//
// Logique PURE de création des enregistrements dans la base produit Supabase
// (Organization + Organization_to_plan + Recruiter) lors d'une « Démo prévue ».
//
// Ce module ne dépend PAS de Prisma ni de la base Neon du CRM : il prend
// directement les données nécessaires en entrée et appelle l'API REST
// PostgREST de Supabase avec la clé service_role. Cela permet de le tester
// avec des données fictives, sans aucune connexion à Neon.
//
// L'orchestration côté CRM (lecture du Deal, idempotence) vit dans
// supabaseProvisioning.ts, qui s'appuie sur ce module.
//
// Variables d'environnement requises (voir .env.example) :
//   SUPABASE_PRODUCT_URL                  (ex : https://xxxx.supabase.co)
//   SUPABASE_PRODUCT_SERVICE_ROLE_KEY     (clé service_role / secret)
// Optionnelles :
//   SUPABASE_PRODUCT_PLAN_ID              (défaut : plan Standard)
//   SUPABASE_PRODUCT_RECRUITER_USER_ID    (défaut : user fixe)
//   SUPABASE_PRODUCT_SMARTLINK_CREDITS    (défaut : 3)

// Valeurs par défaut (staging). Surchargeables via variables d'environnement.
const DEFAULT_PLAN_ID = 'de1d4cbf-5a51-4de5-9aeb-df8119a65489'; // plan « Standard »
const DEFAULT_RECRUITER_USER_ID = 'e05bd473-a010-4658-b0b7-cfd5e344b919';
const DEFAULT_SMARTLINK_CREDITS = 3;

export interface DemoOrganizationInput {
  brandName?: string | null;
  storeName: string;
  city: string;
  siret?: string | null;
}

export interface DemoOrganizationResult {
  organizationId: string;
  organizationName: string;
}

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

/**
 * Construit le nom de l'Organization : « Enseigne Nom-magasin » (sans tiret).
 * (Le paramètre `city` est conservé pour compat ascendante mais n'est plus
 * utilisé : le nom retenu côté produit est « Enseigne + nom du magasin ».)
 */
export function buildOrganizationName(
  brandName: string | null | undefined,
  storeName: string,
  _city?: string,
): string {
  const brand = brandName?.trim();
  const store = storeName?.trim();
  const name = [brand, store].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return name || 'Organisation';
}

// Logos par enseigne (Supabase Storage). Hyper U réutilise le logo Super U.
const STORAGE_LOGOS = 'https://qxjpkjetclwxxpqkbibv.supabase.co/storage/v1/object/public/organization-logos';
const LOGO_INTERMARCHE = `${STORAGE_LOGOS}/fe32e843-52e3-4fe1-9d73-b0e176c4ea1d-1781696630973-intermarch_noyelles_sous_lens`;
const LOGO_SUPER_U = `${STORAGE_LOGOS}/50b358bb-08c5-4330-a70a-59aa971f3e4a-1761232565827-super_u_aiguillon_sur_mer`;
const LOGO_LECLERC = `${STORAGE_LOGOS}/de989ba4-6350-4f23-a838-a61418d4cb0e-1779697785432-leclerc_argentan`;

/** Renvoie l'URL du logo selon l'enseigne, ou null si non reconnue. */
export function getOrganizationLogo(brandName: string | null | undefined): string | null {
  if (!brandName) return null;
  const n = brandName.toLowerCase().trim();
  if (n.includes('intermarch')) return LOGO_INTERMARCHE;
  if (n.includes('hyper u') || n.includes('hyper-u')) return LOGO_SUPER_U;
  if (n.includes('super u') || n.includes('super-u')) return LOGO_SUPER_U;
  if (n.includes('leclerc')) return LOGO_LECLERC;
  return null;
}

/**
 * Crée Organization + Organization_to_plan + Recruiter dans la base produit
 * Supabase à partir de données déjà résolues (aucun accès Neon ici).
 *
 * @param input  Données de l'organisation à créer.
 * @param onOrganizationCreated  Callback optionnel appelé juste après la
 *   création de l'Organization (avant le plan / le recruiter). Permet à
 *   l'appelant de persister l'id immédiatement et de garantir l'idempotence
 *   même si une étape suivante échoue.
 */
export async function createDemoOrganizationRecords(
  input: DemoOrganizationInput,
  onOrganizationCreated?: (organizationId: string) => Promise<void>,
): Promise<DemoOrganizationResult> {
  const planId = process.env.SUPABASE_PRODUCT_PLAN_ID || DEFAULT_PLAN_ID;
  const recruiterUserId =
    process.env.SUPABASE_PRODUCT_RECRUITER_USER_ID || DEFAULT_RECRUITER_USER_ID;
  // Parsing robuste : on doit respecter une valeur explicite de 0 (cas du plan
  // « One shot »), que `Number(x) || DEFAULT` écraserait car 0 est falsy.
  const rawCredits = process.env.SUPABASE_PRODUCT_SMARTLINK_CREDITS;
  const smartlinkCredits =
    rawCredits != null && rawCredits.trim() !== '' && !Number.isNaN(Number(rawCredits))
      ? Number(rawCredits)
      : DEFAULT_SMARTLINK_CREDITS;

  const organizationName = buildOrganizationName(input.brandName, input.storeName, input.city);

  // 1. Organization
  const org = await insertRow<{ id: string }>('Organization', {
    name: organizationName,
    logo: getOrganizationLogo(input.brandName),
    siret: input.siret ?? null,
  });

  if (onOrganizationCreated) await onOrganizationCreated(org.id);

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

  return { organizationId: org.id, organizationName };
}
