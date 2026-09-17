// src/lib/productUser.ts
//
// Création d'un utilisateur dans la base PRODUIT Supabase à la demande, depuis
// une affaire du CRM (bouton « Créer un user » de l'onglet « Recrutement »).
//
// Trois écritures, dans cet ordre, toutes rattachées au MÊME user_id :
//   1. Auth    POST /auth/v1/admin/users  (onglet « Authentication » de Supabase)
//              → email + mot de passe « 00000000 ».
//              → l'id renvoyé est le user_id utilisé aux étapes 2 et 3.
//   2. Table   User(id, first_name, last_name, email)
//   3. Table   Recruiter(user_id, organization_id, company_position,
//              cgu_pp_accepted = true, is_admin = true, configured_at = maintenant)
//
// Module PUR : aucune dépendance à Neon/Prisma. Il reçoit l'organizationId et
// l'état civil en entrée et parle à la base produit via l'API REST PostgREST +
// l'API Auth admin, avec la clé service_role — comme demoOrganization.ts pour
// l'écriture et recruitment.ts pour la lecture.
//
// L'orchestration côté CRM (lecture de l'organisation du deal) vit dans la
// route /api/deals/[id]/create-user.
//
// Rien d'autre n'est touché dans la base produit : aucune ligne existante n'est
// modifiée ni supprimée, et si l'email a déjà un compte Auth, on s'arrête avec
// une erreur explicite plutôt que de rattacher quoi que ce soit à ce compte.
//
// Variables d'environnement requises (voir .env.example) :
//   SUPABASE_PRODUCT_URL                (ex : https://xxxx.supabase.co)
//   SUPABASE_PRODUCT_SERVICE_ROLE_KEY   (clé service_role / secret)

/** Mot de passe posé sur chaque compte créé. */
export const PRODUCT_USER_DEFAULT_PASSWORD = '00000000';

/** Délai maximal accordé à un appel Supabase, pour ne pas bloquer la route. */
const REQUEST_TIMEOUT_MS = 20_000;

export interface CreateProductUserInput {
  /** Organization produit à laquelle rattacher le Recruiter (id Supabase). */
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Poste occupé → colonne `company_position` du Recruiter. */
  companyPosition: string;
}

export interface CreateProductUserResult {
  /** user_id créé dans l'onglet « Authentication », porté par User et Recruiter. */
  userId: string;
}

function productSupabaseConfig(): { baseUrl: string; key: string } {
  const url = process.env.SUPABASE_PRODUCT_URL;
  const key = process.env.SUPABASE_PRODUCT_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Intégration Supabase produit non configurée');
  return { baseUrl: url.replace(/\/$/, ''), key };
}

/** fetch avec clé service_role et garde-fou de temps. */
async function supabaseFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const { key } = productSupabaseConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Insère une ligne via l'API REST PostgREST et renvoie la ligne créée. */
async function insertRow<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const { baseUrl } = productSupabaseConfig();
  const res = await supabaseFetch(`${baseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
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
 * Crée le compte dans l'onglet « Authentication » et renvoie son user_id.
 *
 * `email_confirm: true` (équivalent de « Auto Confirm User » dans Supabase)
 * pour que le compte soit utilisable tout de suite, sans email de confirmation
 * à cliquer.
 */
async function createAuthUser(email: string): Promise<string> {
  const { baseUrl } = productSupabaseConfig();
  const res = await supabaseFetch(`${baseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password: PRODUCT_USER_DEFAULT_PASSWORD,
      email_confirm: true,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    // Email déjà pris : on s'arrête là. On ne touche pas au compte existant
    // (ni mot de passe, ni rattachement) — ce sera à décider à la main.
    if (res.status === 400 || res.status === 422) {
      throw new Error(
        `Aucun compte créé : un utilisateur existe peut-être déjà pour ${email} (${res.status}) : ${detail}`,
      );
    }
    throw new Error(`Création du compte Auth échouée (${res.status}) : ${detail}`);
  }

  const user = (await res.json()) as { id?: string };
  if (!user?.id) throw new Error('Création du compte Auth : réponse inattendue');
  return user.id;
}

/** Contrôle de forme sans prétention : attrape les fautes de frappe évidentes. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Crée le compte Auth + la ligne User + la ligne Recruiter dans la base produit
 * Supabase, à partir d'une organisation déjà résolue (aucun accès Neon ici).
 */
export async function createProductUserRecords(
  input: CreateProductUserInput,
): Promise<CreateProductUserResult> {
  const organizationId = input.organizationId?.trim();
  const email = input.email?.trim();
  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  const companyPosition = input.companyPosition?.trim();

  if (!organizationId) throw new Error('organizationId requis');
  if (!email || !isValidEmail(email)) throw new Error('Email invalide');
  if (!firstName) throw new Error('Prénom requis');
  if (!lastName) throw new Error('Nom requis');
  if (!companyPosition) throw new Error('Poste requis');

  // 1. Compte Auth (onglet « Authentication ») → user_id.
  const userId = await createAuthUser(email);

  // 2. Ligne User (Table Editor), avec ce user_id.
  await insertRow('User', {
    id: userId,
    first_name: firstName,
    last_name: lastName,
    email,
  });

  // 3. Ligne Recruiter : même user_id + organisation du deal.
  //    `configured_at` porte la date et l'heure de l'exécution.
  await insertRow('Recruiter', {
    user_id: userId,
    organization_id: organizationId,
    company_position: companyPosition,
    cgu_pp_accepted: true,
    is_admin: true,
    configured_at: new Date().toISOString(),
  });

  return { userId };
}
