// src/lib/recruitment.ts
//
// Lecture des données de recrutement (Offres + Candidats envoyés) depuis la
// base PRODUIT Supabase, pour alimenter l'onglet « Recrutement » du deal drawer.
//
// Module PUR : aucune dépendance à Neon/Prisma. Il prend l'organizationId en
// entrée (récupéré côté CRM sur Deal.supabaseOrganizationId) et interroge la
// base produit via l'API REST PostgREST avec la clé service_role, comme le fait
// déjà demoOrganization.ts pour l'écriture.
//
// Schéma produit utilisé (cf. base Supabase) :
//   Offer(id, title, organization_id, created_at)
//   Candidate_to_offer(candidate_id, offer_id)   -> candidat « envoyé » sur l'offre
//   Candidate(id, user_id, phone_number)
//   User(id, first_name, last_name)
//
// first_name / last_name ne sont pas portés par Candidate : on remonte au User
// via Candidate.user_id.

export interface RecruitmentCandidate {
  id: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
}

export interface RecruitmentOffer {
  id: string;
  title: string;
  candidates: RecruitmentCandidate[];
}

function productSupabaseConfig(): { baseUrl: string; key: string } | null {
  const url = process.env.SUPABASE_PRODUCT_URL;
  const key = process.env.SUPABASE_PRODUCT_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { baseUrl: url.replace(/\/$/, ''), key };
}

/** Lit des lignes via l'API REST PostgREST (lecture seule). */
async function selectRows<T>(table: string, query: string): Promise<T[]> {
  const cfg = productSupabaseConfig();
  if (!cfg) return [];

  // Timeout réseau : une requête Supabase bloquée ne doit pas faire traîner la
  // fonction jusqu'à sa limite de temps.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
      },
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Select Supabase « ${table} » échoué (${res.status}) : ${detail}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? (data as T[]) : [];
}

/** Construit la liste d'un filtre PostgREST `col=in.(a,b,c)` (ids alphanumériques). */
function inFilter(column: string, ids: string[]): string {
  return `${column}=in.(${ids.map(encodeURIComponent).join(',')})`;
}

/**
 * Nom d'Organization attendu pour un deal : « Enseigne Nom-magasin ».
 * (Si l'enseigne est absente, on retombe sur le seul nom du magasin.)
 */
export function buildDealOrganizationName(
  brandName: string | null | undefined,
  storeName: string | null | undefined,
): string {
  const brand = brandName?.trim();
  const store = storeName?.trim();
  return [brand, store].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Recherche des Organizations par nom (correspondance exacte via `eq`, qui peut
 * s'appuyer sur un index — contrairement à `ilike` qui force un balayage
 * séquentiel sur une grosse table). Renvoie les correspondances {id, name}.
 */
export async function findOrganizationsByName(
  name: string,
): Promise<{ id: string; name: string }[]> {
  const value = name.trim();
  if (!value) return [];
  return selectRows<{ id: string; name: string }>(
    'Organization',
    `name=eq.${encodeURIComponent(value)}&select=id,name&limit=5`,
  );
}

/** Normalise un nom pour comparaison : minuscules, sans accents, espaces compactés. */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Récupère les Organizations dont le nom figure dans `names` (correspondance
 * exacte, via des requêtes `in` par paquets). Ciblé : on ne charge jamais toute
 * la table Organization (qui peut être énorme côté produit), seulement les
 * organisations potentiellement liées aux deals.
 */
export async function findOrganizationsByNames(
  names: string[],
): Promise<{ id: string; name: string }[]> {
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  if (unique.length === 0) return [];

  const chunkSize = 60; // limite la longueur d'URL
  const out: { id: string; name: string }[] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    // PostgREST : name=in.("Foo","Bar") — guillemets pour gérer espaces/casse.
    const list = chunk.map((n) => `"${n.replace(/["\\]/g, '')}"`).join(',');
    const rows = await selectRows<{ id: string; name: string }>(
      'Organization',
      `name=in.${encodeURIComponent(`(${list})`)}&select=id,name`,
    );
    out.push(...rows);
  }
  // Dédoublonnage par id (un même chunk peut renvoyer des doublons logiques).
  return Array.from(new Map(out.map((o) => [o.id, o])).values());
}

export type OrganizationMatchStatus = 'matched' | 'ambiguous' | 'not_found';

export interface OrganizationMatchResult {
  organizationId: string | null;
  matchedName: string | null;
  /** Nom utilisé pour la correspondance retenue : 'store' (enseigne+magasin) ou 'city' (enseigne+ville). */
  matchedBy: 'store' | 'city' | null;
  status: OrganizationMatchStatus;
}

/** Index nom-normalisé -> organisations, pour un matching en mémoire. */
export type OrganizationIndex = Map<string, { id: string; name: string }[]>;

export function buildOrganizationIndex(orgs: { id: string; name: string }[]): OrganizationIndex {
  const index: OrganizationIndex = new Map();
  for (const org of orgs) {
    const key = normalizeName(org.name);
    if (!key) continue;
    const arr = index.get(key) ?? [];
    arr.push(org);
    index.set(key, arr);
  }
  return index;
}

/**
 * Noms candidats pour un deal : « Enseigne Nom-magasin » puis « Enseigne Ville ».
 * On n'ajoute un candidat que si sa partie « lieu » (nom-magasin ou ville) est
 * renseignée : sinon le nom se réduirait à l'enseigne seule (« Leclerc »,
 * « Intermarché »…) et matcherait par erreur des organisations homonymes.
 */
function dealNameCandidates(input: {
  brandName?: string | null;
  storeName?: string | null;
  city?: string | null;
}): { by: 'store' | 'city'; name: string }[] {
  const store = input.storeName?.trim() || '';
  const city = input.city?.trim() || '';
  const candidates: { by: 'store' | 'city'; name: string }[] = [];
  if (store) candidates.push({ by: 'store', name: buildDealOrganizationName(input.brandName, store) });
  if (city && normalizeName(city) !== normalizeName(store)) {
    candidates.push({ by: 'city', name: buildDealOrganizationName(input.brandName, city) });
  }
  return candidates;
}

/** Matching en mémoire d'un deal contre un index d'organisations (unique sinon ambiguous). */
export function matchDealOrganizationInIndex(
  index: OrganizationIndex,
  input: { brandName?: string | null; storeName?: string | null; city?: string | null },
): OrganizationMatchResult {
  for (const candidate of dealNameCandidates(input)) {
    const hits = index.get(normalizeName(candidate.name)) ?? [];
    const unique = Array.from(new Map(hits.map((h) => [h.id, h])).values());
    if (unique.length === 1) {
      return { organizationId: unique[0].id, matchedName: unique[0].name, matchedBy: candidate.by, status: 'matched' };
    }
    if (unique.length > 1) {
      return { organizationId: null, matchedName: candidate.name, matchedBy: candidate.by, status: 'ambiguous' };
    }
  }
  return { organizationId: null, matchedName: null, matchedBy: null, status: 'not_found' };
}

/**
 * Tente de retrouver l'Organization produit correspondant à un deal, par son
 * nom. Essaie d'abord « Enseigne Nom-magasin », puis en repli « Enseigne Ville »
 * (format historique de provisioning). Une correspondance n'est retenue que si
 * elle est unique (sinon `ambiguous`). Variante « 1 deal » (≤ 2 requêtes), pour
 * le rattachement à la volée ; pour le backfill en masse, préférer l'index.
 */
export async function matchDealOrganization(input: {
  brandName?: string | null;
  storeName?: string | null;
  city?: string | null;
}): Promise<OrganizationMatchResult> {
  for (const candidate of dealNameCandidates(input)) {
    const matches = await findOrganizationsByName(candidate.name);
    // Dédoublonnage par id (au cas où ilike renvoie des doublons logiques).
    const unique = Array.from(new Map(matches.map((m) => [m.id, m])).values());
    if (unique.length === 1) {
      return { organizationId: unique[0].id, matchedName: unique[0].name, matchedBy: candidate.by, status: 'matched' };
    }
    if (unique.length > 1) {
      return { organizationId: null, matchedName: candidate.name, matchedBy: candidate.by, status: 'ambiguous' };
    }
  }
  return { organizationId: null, matchedName: null, matchedBy: null, status: 'not_found' };
}

/** Offre produit brute (table Offer de Supabase), lecture seule. */
export interface ProductOffer {
  id: string;
  title: string | null;
  organization_id: string;
  created_at: string | null;
}

/**
 * Récupère les offres (id, title, organization_id, created_at) des Organizations
 * demandées, les plus récentes d'abord. Ciblé (requêtes `in` par paquets) : on ne
 * charge jamais toute la table Offer. Lecture seule ; [] si non configuré.
 */
export async function fetchOffersForOrganizations(
  organizationIds: string[],
): Promise<ProductOffer[]> {
  const orgIds = Array.from(new Set(organizationIds.filter(Boolean)));
  if (orgIds.length === 0) return [];

  const chunkSize = 60; // limite la longueur d'URL
  const out: ProductOffer[] = [];
  for (let i = 0; i < orgIds.length; i += chunkSize) {
    const chunk = orgIds.slice(i, i + chunkSize);
    const rows = await selectRows<ProductOffer>(
      'Offer',
      `${inFilter('organization_id', chunk)}&select=id,title,organization_id,created_at&order=created_at.desc`,
    );
    out.push(...rows);
  }
  return out;
}

export interface OrganizationRecruitment {
  organizationId: string;
  organizationName: string;
  offers: RecruitmentOffer[];
}

/** Récupère une Organization par id (nom), ou null si introuvable. */
export async function fetchOrganizationById(
  organizationId: string,
): Promise<{ id: string; name: string } | null> {
  if (!organizationId) return null;
  const rows = await selectRows<{ id: string; name: string | null }>(
    'Organization',
    `id=eq.${encodeURIComponent(organizationId)}&select=id,name&limit=1`,
  );
  return rows[0] ? { id: rows[0].id, name: rows[0].name?.trim() || 'Organisation' } : null;
}

/**
 * Récupère, pour une ou plusieurs Organizations, leurs offres avec les
 * candidats likés envoyés (regroupées par organisation). Chaque organisation
 * demandée est présente dans le résultat, même sans offre.
 *
 * Renvoie un tableau vide si l'intégration n'est pas configurée.
 */
export async function fetchOrganizationsRecruitment(
  organizationIds: string[],
): Promise<OrganizationRecruitment[]> {
  const orgIds = Array.from(new Set(organizationIds.filter(Boolean)));
  if (orgIds.length === 0) return [];

  // Noms des organisations.
  const orgs = await selectRows<{ id: string; name: string | null }>(
    'Organization',
    `${inFilter('id', orgIds)}&select=id,name`,
  );
  const nameById = new Map(orgs.map((o) => [o.id, o.name?.trim() || 'Organisation']));

  // Offres de toutes les organisations (les plus récentes d'abord).
  const offers = await selectRows<{ id: string; title: string | null; organization_id: string }>(
    'Offer',
    `${inFilter('organization_id', orgIds)}&select=id,title,organization_id&order=created_at.desc`,
  );
  const offerIds = offers.map((o) => o.id);

  // Liens candidat ↔ offre (likés uniquement).
  const links = offerIds.length
    ? await selectRows<{ candidate_id: string; offer_id: string }>(
        'Candidate_to_offer',
        `${inFilter('offer_id', offerIds)}&is_liked=eq.true&select=candidate_id,offer_id`,
      )
    : [];

  const candidateIds = Array.from(new Set(links.map((l) => l.candidate_id)));
  const candidates = candidateIds.length
    ? await selectRows<{ id: string; phone_number: string | null; user_id: string | null }>(
        'Candidate',
        `${inFilter('id', candidateIds)}&select=id,phone_number,user_id`,
      )
    : [];

  const userIds = Array.from(
    new Set(candidates.map((c) => c.user_id).filter((id): id is string => Boolean(id))),
  );
  const users = userIds.length
    ? await selectRows<{ id: string; first_name: string | null; last_name: string | null }>(
        'User',
        `${inFilter('id', userIds)}&select=id,first_name,last_name`,
      )
    : [];

  const userById = new Map(users.map((u) => [u.id, u]));
  const candidateById = new Map<string, RecruitmentCandidate>(
    candidates.map((c) => {
      const u = c.user_id ? userById.get(c.user_id) : undefined;
      return [
        c.id,
        { id: c.id, firstName: u?.first_name ?? '', lastName: u?.last_name ?? '', phoneNumber: c.phone_number ?? '' },
      ];
    }),
  );

  const candidatesByOffer = new Map<string, RecruitmentCandidate[]>();
  for (const link of links) {
    const candidate = candidateById.get(link.candidate_id);
    if (!candidate) continue;
    const list = candidatesByOffer.get(link.offer_id) ?? [];
    list.push(candidate);
    candidatesByOffer.set(link.offer_id, list);
  }

  // Regroupe les offres par organisation.
  const offersByOrg = new Map<string, RecruitmentOffer[]>();
  for (const o of offers) {
    const list = offersByOrg.get(o.organization_id) ?? [];
    list.push({ id: o.id, title: o.title?.trim() || 'Offre', candidates: candidatesByOffer.get(o.id) ?? [] });
    offersByOrg.set(o.organization_id, list);
  }

  // Une entrée par organisation demandée (ordre d'entrée préservé).
  return orgIds.map((id) => ({
    organizationId: id,
    organizationName: nameById.get(id) || 'Organisation',
    offers: offersByOrg.get(id) ?? [],
  }));
}
