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

  const res = await fetch(`${cfg.baseUrl}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
    },
    cache: 'no-store',
  });

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
 * Récupère les offres d'une Organization (base produit) avec, pour chacune, la
 * liste des candidats qui lui ont été envoyés (table Candidate_to_offer).
 *
 * Renvoie un tableau vide si l'intégration n'est pas configurée.
 */
export async function fetchOrganizationRecruitment(
  organizationId: string,
): Promise<RecruitmentOffer[]> {
  // 1. Offres de l'organisation (les plus récentes d'abord).
  const offers = await selectRows<{ id: string; title: string | null }>(
    'Offer',
    `organization_id=eq.${encodeURIComponent(organizationId)}&select=id,title&order=created_at.desc`,
  );
  if (offers.length === 0) return [];

  const offerIds = offers.map((o) => o.id);

  // 2. Liens candidat ↔ offre (candidats « envoyés »).
  const links = await selectRows<{ candidate_id: string; offer_id: string }>(
    'Candidate_to_offer',
    `${inFilter('offer_id', offerIds)}&select=candidate_id,offer_id`,
  );

  const candidateIds = Array.from(new Set(links.map((l) => l.candidate_id)));

  // 3. Candidats (téléphone porté directement, prénom/nom via le User lié).
  const candidates = candidateIds.length
    ? await selectRows<{ id: string; phone_number: string | null; user_id: string | null }>(
        'Candidate',
        `${inFilter('id', candidateIds)}&select=id,phone_number,user_id`,
      )
    : [];

  const userIds = Array.from(
    new Set(candidates.map((c) => c.user_id).filter((id): id is string => Boolean(id))),
  );

  // 4. Utilisateurs (prénom / nom).
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
        {
          id: c.id,
          firstName: u?.first_name ?? '',
          lastName: u?.last_name ?? '',
          phoneNumber: c.phone_number ?? '',
        },
      ];
    }),
  );

  // 5. Regroupe les candidats par offre (en préservant l'ordre des offres).
  const candidatesByOffer = new Map<string, RecruitmentCandidate[]>();
  for (const link of links) {
    const candidate = candidateById.get(link.candidate_id);
    if (!candidate) continue;
    const list = candidatesByOffer.get(link.offer_id) ?? [];
    list.push(candidate);
    candidatesByOffer.set(link.offer_id, list);
  }

  return offers.map((o) => ({
    id: o.id,
    title: o.title?.trim() || 'Offre',
    candidates: candidatesByOffer.get(o.id) ?? [],
  }));
}
