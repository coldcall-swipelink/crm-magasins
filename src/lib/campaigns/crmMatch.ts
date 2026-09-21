// src/lib/campaigns/crmMatch.ts
//
// Rapprochement d'un lead et d'une affaire du CRM par ENSEIGNE + VILLE.
//
// Un lead importé d'un fichier ne porte pas l'identifiant de son affaire : on
// n'a que « Leclerc » et « Montpellier ». Si une affaire du CRM décrit ce même
// magasin, il faut le savoir AVANT d'écrire — c'est peut-être un contact qu'on
// a déjà au téléphone, ou une affaire déjà signée.
//
// Le rattachement explicite (Lead.dealId, posé par « Importer depuis le CRM »)
// et la liaison par adresse email restent la vérité (cf. crmLink.ts). Ce
// module n'ajoute qu'un SIGNAL : « ce lead ressemble à cette affaire ». Il
// n'écrit rien et ne rattache rien — un rapprochement d'enseigne et de ville
// n'est pas une preuve que c'est le même contact, seulement le même magasin.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** Casse, accents et ponctuation retirés : « E.Leclerc » → « eleclerc ». */
export function matchKey(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Deux enseignes désignent-elles la même ? « E.Leclerc » et « Leclerc »,
 * « Intermarché » et « Intermarché Contact » : l'une contient l'autre une fois
 * normalisée. Trois caractères au minimum, sinon « SA » rapprocherait tout.
 */
export function sameBrand(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = matchKey(a);
  const y = matchKey(b);
  if (x.length < 3 || y.length < 3) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** Même ville : comparaison stricte une fois normalisée. */
export function sameCity(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = matchKey(a);
  const y = matchKey(b);
  return x.length > 0 && x === y;
}

/** L'affaire telle qu'on la montre à côté d'un lead. */
export type MatchedDeal = {
  dealId: string;
  pipeline: string;
  column: string;
  color: string;
  store: string;
  brand: string;
  city: string;
};

/** Comment le lead et l'affaire ont été mis en regard. */
export type CrmMatchKind =
  /** Rattachement explicite (Lead.dealId) : le lead VIENT de cette affaire. */
  | 'linked'
  /** Même enseigne et même ville : probablement le même magasin. */
  | 'matched';

export type LeadCrmMatch = MatchedDeal & { kind: CrmMatchKind; others: number };

const DEAL_SELECT = {
  id: true,
  pipeline: { select: { name: true } },
  column: { select: { title: true, color: true } },
  store: { select: { name: true, city: true, brand: { select: { name: true } } } },
} satisfies Prisma.DealSelect;

type SelectedDeal = {
  id: string;
  pipeline: { name: string } | null;
  column: { title: string; color: string } | null;
  store: { name: string; city: string; brand: { name: string } | null } | null;
};

function describe(deal: SelectedDeal): MatchedDeal {
  return {
    dealId: deal.id,
    pipeline: deal.pipeline?.name || '',
    column: deal.column?.title || '',
    color: deal.column?.color || '#6366f1',
    store: deal.store?.name || '',
    brand: deal.store?.brand?.name || '',
    city: deal.store?.city || '',
  };
}

/** Ce dont le rapprochement a besoin d'un lead. */
export type MatchableLead = {
  id: string;
  dealId: string | null;
  company: string | null;
  city: string | null;
};

/**
 * Pour chaque lead d'une page, l'affaire à lui montrer.
 *
 * Une seule requête pour toute la page : on ramène les affaires des villes
 * concernées, puis on compare les enseignes en mémoire — Prisma ne sait pas
 * comparer en ignorant la ponctuation, et « E.Leclerc » doit rapprocher
 * « Leclerc ».
 */
export async function matchDealsForLeads(leads: MatchableLead[]): Promise<Map<string, LeadCrmMatch>> {
  const result = new Map<string, LeadCrmMatch>();
  if (leads.length === 0) return result;

  // 1. Rattachements explicites : ils l'emportent sur tout rapprochement.
  const linkedIds = Array.from(new Set(leads.map(lead => lead.dealId).filter((id): id is string => !!id)));
  const linked = linkedIds.length
    ? await prisma.deal.findMany({ where: { id: { in: linkedIds } }, select: DEAL_SELECT })
    : [];
  const linkedById = new Map(linked.map(deal => [deal.id, deal]));

  // 2. Rapprochement enseigne + ville, pour les leads sans rattachement.
  const loose = leads.filter(lead => !(lead.dealId && linkedById.has(lead.dealId)));
  const cities = Array.from(new Set(
    loose.map(lead => (lead.city || '').trim()).filter(city => matchKey(city).length > 0),
  ));

  const candidates = cities.length
    ? await prisma.deal.findMany({
        where: { OR: cities.map(city => ({ store: { city: { equals: city, mode: 'insensitive' as const } } })) },
        select: DEAL_SELECT,
        // Garde-fou : une ville très fournie ne doit pas ramener toute la base.
        take: 2000,
      })
    : [];

  for (const lead of leads) {
    const explicit = lead.dealId ? linkedById.get(lead.dealId) : undefined;
    if (explicit) {
      result.set(lead.id, { ...describe(explicit), kind: 'linked', others: 0 });
      continue;
    }
    if (!lead.company || !lead.city) continue;
    const hits = candidates.filter(deal =>
      sameCity(deal.store?.city, lead.city) && sameBrand(deal.store?.brand?.name, lead.company));
    if (hits.length === 0) continue;
    // Plusieurs affaires pour un même magasin : on montre la première et on
    // dit combien il y en a d'autres, plutôt que d'en cacher une.
    result.set(lead.id, { ...describe(hits[0]), kind: 'matched', others: hits.length - 1 });
  }

  return result;
}

/** Un lead rapproché d'une affaire, vu depuis le CRM. */
export type DealLeadMatch = {
  id: string;
  email: string;
  name: string;
  jobTitle: string;
  company: string;
  city: string;
  status: string;
  kind: CrmMatchKind;
  lastContactedAt: string | null;
  /** Campagnes dans lesquelles ce lead est inscrit. */
  campaigns: Array<{ id: string; name: string; status: string }>;
};

/**
 * Les leads de prospection qui correspondent à une affaire.
 *
 * Rattachés explicitement, ou de même enseigne et même ville. Sert au bloc
 * « Leads de campagne » de la fiche affaire : savoir, avant d'appeler, qu'une
 * séquence d'emails tourne déjà sur ce magasin.
 */
export async function matchLeadsForDeal(dealId: string): Promise<DealLeadMatch[]> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, store: { select: { city: true, brand: { select: { name: true } } } } },
  });
  if (!deal) return [];

  const brand = deal.store?.brand?.name || '';
  const city = deal.store?.city || '';

  const select = {
    id: true, email: true, civility: true, firstName: true, lastName: true,
    jobTitle: true, company: true, city: true, status: true, dealId: true,
    lastContactedAt: true,
    enrollments: { select: { campaign: { select: { id: true, name: true, status: true } } } },
  } as const;

  const [linked, sameTown] = await Promise.all([
    prisma.lead.findMany({ where: { dealId }, select }),
    matchKey(city).length > 0 && matchKey(brand).length >= 3
      ? prisma.lead.findMany({
          where: { city: { equals: city, mode: 'insensitive' }, dealId: null },
          select,
          take: 200,
        })
      : Promise.resolve([]),
  ]);

  const seen = new Set(linked.map(lead => lead.id));
  const rows = [
    ...linked.map(lead => ({ lead, kind: 'linked' as const })),
    ...sameTown
      .filter(lead => !seen.has(lead.id) && sameBrand(lead.company, brand))
      .map(lead => ({ lead, kind: 'matched' as const })),
  ];

  return rows.map(({ lead, kind }) => ({
    id: lead.id,
    email: lead.email,
    name: [lead.civility, lead.firstName, lead.lastName].filter(Boolean).join(' '),
    jobTitle: lead.jobTitle || '',
    company: lead.company || '',
    city: lead.city || '',
    status: lead.status,
    kind,
    lastContactedAt: lead.lastContactedAt ? lead.lastContactedAt.toISOString() : null,
    campaigns: lead.enrollments.map(item => item.campaign),
  }));
}
