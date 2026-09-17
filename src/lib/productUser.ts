// src/lib/productUser.ts
//
// Création d'un utilisateur dans la base PRODUIT Supabase à la demande, depuis
// une affaire du CRM (bouton « Créer un user » de l'onglet « Recrutement »).
//
// Trois écritures, dans cet ordre, toutes rattachées au MÊME user_id :
//   1. Auth    POST /auth/v1/admin/users  (onglet « Authentication » de Supabase)
//              → email + mot de passe « 00000000 », email déjà confirmé.
//              → l'id renvoyé est le user_id utilisé aux étapes 2 et 3.
//   2. Table   User(id, first_name, last_name, email)
//   3. Table   Recruiter(user_id, organization_id, company_position, is_admin,
//              configured_at) — l'organization_id est celui rattaché au deal.
//
// Module PUR : aucune dépendance à Neon/Prisma. Il reçoit l'organizationId et
// l'état civil en entrée et parle à la base produit via l'API REST PostgREST +
// l'API Auth admin, avec la clé service_role — comme demoOrganization.ts pour
// l'écriture et recruitment.ts pour la lecture.
//
// L'orchestration côté CRM (résolution de l'organisation du deal) vit dans la
// route /api/deals/[id]/create-user.
//
// Idempotent, étape par étape : chaque étape vérifie d'abord si elle a déjà été
// faite. Un échec partiel (compte Auth créé, puis erreur sur la ligne User) se
// rattrape donc en rejouant simplement le bouton avec le même email.
//
// Variables d'environnement requises (voir .env.example) :
//   SUPABASE_PRODUCT_URL                (ex : https://xxxx.supabase.co)
//   SUPABASE_PRODUCT_SERVICE_ROLE_KEY   (clé service_role / secret)

/** Mot de passe posé sur chaque compte créé (l'utilisateur le changera). */
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
  /** Recruiter administrateur de l'organisation (défaut : oui). */
  isAdmin?: boolean;
}

export interface CreateProductUserResult {
  userId: string;
  /** false = le compte Auth existait déjà (email déjà pris) et a été réutilisé. */
  authCreated: boolean;
  /** false = la ligne User existait déjà pour ce user_id. */
  userRowCreated: boolean;
  /** false = un Recruiter existait déjà pour ce couple user/organisation. */
  recruiterCreated: boolean;
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

/** Lit des lignes via l'API REST PostgREST (filtre PostgREST brut). */
async function selectRows<T>(table: string, query: string): Promise<T[]> {
  const { baseUrl } = productSupabaseConfig();
  const res = await supabaseFetch(`${baseUrl}/rest/v1/${table}?${query}`);
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Select Supabase « ${table} » échoué (${res.status}) : ${detail}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? (data as T[]) : [];
}

/**
 * Retrouve le compte Auth d'un email. Sert uniquement à reprendre un
 * provisioning interrompu : si le compte existe déjà, on récupère son id au
 * lieu d'échouer, et on termine les lignes User / Recruiter.
 *
 * On filtre côté serveur (`filter`, comme le fait le Studio Supabase) PUIS on
 * revérifie l'email exact côté CRM : si la version de GoTrue ignore le filtre,
 * on ne risque pas de rattacher le premier utilisateur venu.
 */
async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const { baseUrl } = productSupabaseConfig();
  const res = await supabaseFetch(
    `${baseUrl}/auth/v1/admin/users?per_page=200&filter=${encodeURIComponent(email)}`,
  );
  if (!res.ok) return null;

  const body = (await res.json().catch(() => null)) as { users?: { id?: string; email?: string }[] } | null;
  const users = Array.isArray(body?.users) ? body!.users! : [];
  const target = email.trim().toLowerCase();
  const match = users.find((u) => typeof u.email === 'string' && u.email.toLowerCase() === target);
  return match?.id ?? null;
}

/**
 * Crée le compte dans l'onglet « Authentication » et renvoie son user_id.
 * `email_confirm: true` : le compte est utilisable tout de suite, sans que le
 * magasin ait à cliquer sur un email de confirmation.
 */
async function createAuthUser(email: string): Promise<{ userId: string; created: boolean }> {
  const { baseUrl } = productSupabaseConfig();
  const res = await supabaseFetch(`${baseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password: PRODUCT_USER_DEFAULT_PASSWORD,
      email_confirm: true,
    }),
  });

  if (res.ok) {
    const user = (await res.json()) as { id?: string };
    if (!user?.id) throw new Error('Création du compte Auth : réponse inattendue');
    return { userId: user.id, created: true };
  }

  const detail = await res.text();
  // 400 / 422 « email_exists » : le compte existe déjà (souvent une tentative
  // précédente interrompue). On le réutilise plutôt que de bloquer.
  if (res.status === 400 || res.status === 422) {
    const existing = await findAuthUserIdByEmail(email);
    if (existing) return { userId: existing, created: false };
    throw new Error(
      `Un compte Auth existe peut-être déjà pour ${email}, sans avoir pu être récupéré (${res.status}) : ${detail}`,
    );
  }
  throw new Error(`Création du compte Auth échouée (${res.status}) : ${detail}`);
}

/** Vrai si PostgREST rejette l'insert parce que la colonne `email` n'existe pas. */
function isUnknownEmailColumn(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("'email'") || (message.includes('email') && message.includes('PGRST204'));
}

/** Ligne `User` (état civil du compte). Ne recrée rien si l'id est déjà là. */
async function ensureUserRow(
  userId: string,
  firstName: string,
  lastName: string,
  email: string,
): Promise<boolean> {
  const existing = await selectRows<{ id: string }>(
    'User',
    `id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
  );
  if (existing.length > 0) return false;

  const row = { id: userId, first_name: firstName, last_name: lastName, email };
  try {
    await insertRow('User', row);
  } catch (err) {
    // Filet : si la table User ne porte pas de colonne `email` (l'email vit
    // alors uniquement dans Auth), on réinsère sans elle au lieu d'échouer.
    if (!isUnknownEmailColumn(err)) throw err;
    await insertRow('User', { id: userId, first_name: firstName, last_name: lastName });
  }
  return true;
}

/**
 * Ligne `Recruiter` rattachant le user à l'Organization du deal.
 * `configured_at` porte la date et l'heure de l'exécution.
 *
 * Idempotent : pas de second Recruiter si le couple user/organisation existe.
 */
async function ensureRecruiterRow(
  userId: string,
  organizationId: string,
  companyPosition: string,
  isAdmin: boolean,
): Promise<boolean> {
  const existing = await selectRows<{ id: string }>(
    'Recruiter',
    `user_id=eq.${encodeURIComponent(userId)}` +
      `&organization_id=eq.${encodeURIComponent(organizationId)}` +
      `&select=id&limit=1`,
  );
  if (existing.length > 0) return false;

  await insertRow('Recruiter', {
    user_id: userId,
    organization_id: organizationId,
    company_position: companyPosition,
    is_admin: isAdmin,
    configured_at: new Date().toISOString(),
  });
  return true;
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
  const auth = await createAuthUser(email);

  // 2. Ligne User (Table Editor), avec ce user_id.
  const userRowCreated = await ensureUserRow(auth.userId, firstName, lastName, email);

  // 3. Ligne Recruiter, même user_id + organisation du deal.
  const recruiterCreated = await ensureRecruiterRow(
    auth.userId,
    organizationId,
    companyPosition,
    input.isAdmin !== false,
  );

  return {
    userId: auth.userId,
    authCreated: auth.created,
    userRowCreated,
    recruiterCreated,
  };
}
