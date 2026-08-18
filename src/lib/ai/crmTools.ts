// src/lib/ai/crmTools.ts
// -----------------------------------------------------------------------------
// Outils (« tools ») exposés à Claude pour interroger, en LECTURE SEULE, les
// données réelles du CRM. Chaque outil est décrit (schéma JSON) pour que le
// modèle sache quand et comment l'appeler, puis exécuté côté serveur via Prisma.
// Aucun outil n'écrit en base : l'assistant ne fait que lire et agréger.
// -----------------------------------------------------------------------------
import { prisma } from '@/lib/prisma';
import { findStoreIdsMatchingSearch } from '@/lib/searchStores';

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// --- Helpers ----------------------------------------------------------------

// Accepte "YYYY-MM-DD" (interprété en heure locale, début de journée) ou une
// date ISO complète. Renvoie undefined si absent / invalide.
function parseDate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const iso = value.length <= 10 ? `${value}T00:00:00` : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Borne de fin incluse : on prend la fin de journée pour la date "to".
function endOfDay(value?: string | null): Date | undefined {
  const d = parseDate(value);
  if (!d) return undefined;
  if ((value ?? '').length <= 10) d.setHours(23, 59, 59, 999);
  return d;
}

const round = (n: number) => Math.round(n * 100) / 100;

// --- Définitions exposées au modèle ----------------------------------------

export const CRM_TOOLS: ToolDefinition[] = [
  {
    name: 'query_closings',
    description:
      "Analyse des closings (ventes gagnées / abonnements signés). Un closing = un abonnement dont la date de closing est renseignée. Filtrable par période (from/to) et par enseigne. Renvoie : nombre de closings, nombre de clients distincts, MRR total (somme des valeurs MENSUELLES), ARR (MRR×12), valeur totale du contrat, répartition par enseigne / type d'abonnement / mode de paiement, et la liste des closings. À utiliser pour TOUTE question sur le chiffre d'affaires, le MRR, le nombre de ventes ou de closings sur une période (ex. « combien de closings ces 3 derniers mois »).",
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Date de début incluse, format YYYY-MM-DD.' },
        to: { type: 'string', description: 'Date de fin incluse, format YYYY-MM-DD.' },
        brandName: { type: 'string', description: 'Filtrer sur une enseigne par son nom (insensible à la casse).' },
      },
    },
  },
  {
    name: 'get_pipeline_overview',
    description:
      "Vue d'ensemble du pipeline commercial : pour chaque étape/colonne, le nombre d'affaires (deals) et la valeur cumulée, plus les totaux globaux (nombre total d'affaires, de magasins, d'offres d'emploi actives). À utiliser pour « combien d'affaires en cours », « répartition du pipeline », « combien d'affaires dans l'étape X ».",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_deals',
    description:
      "Recherche et liste des affaires (deals) avec leurs détails : magasin, ville, enseigne, étape du pipeline, valeur, directeur, contact, priorité, dates clés (démo, closing). Filtrable par texte libre (magasin/ville/enseigne), étape, enseigne, priorité. À utiliser pour « quelles affaires… », « liste les magasins… », ou toute question sur des deals précis.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texte recherché dans le nom du magasin, la ville ou l\'enseigne.' },
        columnTitle: { type: 'string', description: "Filtrer sur le nom d'une étape du pipeline (insensible à la casse)." },
        brandName: { type: 'string', description: "Filtrer sur une enseigne par son nom (insensible à la casse)." },
        priority: { type: 'string', description: 'Filtrer sur la priorité (ex. haute, normale, basse).' },
        limit: { type: 'number', description: 'Nombre max de résultats (défaut 25, max 100).' },
      },
    },
  },
  {
    name: 'get_actions',
    description:
      "Actions et rappels (tâches) du CRM. Filtrable par statut (todo/done) et portée (overdue = en retard, today = aujourd'hui, upcoming = à venir, all = toutes). Renvoie le nombre et la liste (titre, type, échéance, magasin lié, personne assignée). À utiliser pour « actions en retard », « rappels du jour », « combien de tâches à faire ».",
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['todo', 'done'], description: 'Statut des actions (défaut : todo).' },
        scope: { type: 'string', enum: ['overdue', 'today', 'upcoming', 'all'], description: 'Portée temporelle (défaut : all).' },
        limit: { type: 'number', description: 'Nombre max de résultats (défaut 25, max 100).' },
      },
    },
  },
  {
    name: 'get_brands',
    description:
      "Liste des enseignes (marques) avec le nombre de magasins et d'affaires rattachés. À utiliser pour « quelles enseignes », « combien de magasins par enseigne », « top enseignes ».",
    input_schema: { type: 'object', properties: {} },
  },
];

// --- Exécution ---------------------------------------------------------------

export async function runCrmTool(name: string, input: Record<string, any>): Promise<unknown> {
  switch (name) {
    case 'query_closings':
      return queryClosings(input);
    case 'get_pipeline_overview':
      return getPipelineOverview();
    case 'search_deals':
      return searchDeals(input);
    case 'get_actions':
      return getActions(input);
    case 'get_brands':
      return getBrands();
    default:
      return { error: `Outil inconnu : ${name}` };
  }
}

async function queryClosings(input: Record<string, any>) {
  const from = parseDate(input.from);
  const to = endOfDay(input.to);
  const brandName: string | undefined = input.brandName?.trim() || undefined;

  const closingDate: Record<string, Date> = {};
  if (from) closingDate.gte = from;
  if (to) closingDate.lte = to;

  const where: Record<string, unknown> = {
    // Abonnements résiliés (churn) exclus : cohérent avec le Dashboard, leur
    // valeur ne compte plus dans le MRR ni les analyses de closing.
    closingDate: { not: null, ...closingDate },
    churned: false,
  };
  if (brandName) {
    where.deal = { store: { brand: { name: { equals: brandName, mode: 'insensitive' } } } };
  }

  const subs = await prisma.subscription.findMany({
    where,
    select: {
      value: true,
      subscriptionType: true,
      paymentMode: true,
      subscriptionMonths: true,
      closingDate: true,
      deal: {
        select: {
          id: true,
          store: { select: { name: true, city: true, brand: { select: { name: true } } } },
        },
      },
    },
    orderBy: { closingDate: 'desc' },
  });

  const mrr = subs.reduce((s, x) => s + (x.value ?? 0), 0);
  const contractValue = subs.reduce((s, x) => s + (x.value ?? 0) * (x.subscriptionMonths ?? 12), 0);
  const distinctClients = new Set(subs.map((x) => x.deal?.id).filter(Boolean)).size;

  const groupSum = (keyFn: (x: (typeof subs)[number]) => string) => {
    const map = new Map<string, { count: number; mrr: number }>();
    for (const x of subs) {
      const k = keyFn(x);
      const e = map.get(k) ?? { count: 0, mrr: 0 };
      e.count += 1;
      e.mrr += x.value ?? 0;
      map.set(k, e);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, count: v.count, mrr: round(v.mrr) }))
      .sort((a, b) => b.mrr - a.mrr);
  };

  return {
    period: { from: input.from ?? null, to: input.to ?? null, brand: brandName ?? null },
    closingsCount: subs.length,
    distinctClients,
    mrr: round(mrr),
    arr: round(mrr * 12),
    totalContractValue: round(contractValue),
    note: "value = montant MENSUEL de l'abonnement. MRR = somme des montants mensuels. ARR = MRR×12.",
    byBrand: groupSum((x) => x.deal?.store?.brand?.name ?? 'Sans enseigne'),
    byType: groupSum((x) => x.subscriptionType?.trim() || 'Non renseigné'),
    byPaymentMode: groupSum((x) => (x.paymentMode === 'virement' ? 'virement' : 'stripe')),
    closings: subs.slice(0, 50).map((x) => ({
      date: x.closingDate?.toISOString().slice(0, 10) ?? null,
      store: x.deal?.store?.name ?? '',
      city: x.deal?.store?.city ?? '',
      brand: x.deal?.store?.brand?.name ?? 'Sans enseigne',
      type: x.subscriptionType || null,
      monthlyValue: x.value ?? 0,
      months: x.subscriptionMonths ?? 12,
      paymentMode: x.paymentMode === 'virement' ? 'virement' : 'stripe',
    })),
    truncated: subs.length > 50,
  };
}

async function getPipelineOverview() {
  const [columns, totalDeals, totalStores, activeOffers] = await Promise.all([
    prisma.pipelineColumn.findMany({
      orderBy: [{ pipeline: { position: 'asc' } }, { position: 'asc' }],
      select: {
        title: true,
        pipeline: { select: { name: true } },
        deals: { where: { parentDealId: null }, select: { dealValue: true } },
      },
    }),
    prisma.deal.count({ where: { parentDealId: null } }),
    prisma.store.count(),
    prisma.jobOffer.count(),
  ]);

  return {
    totals: { deals: totalDeals, stores: totalStores, activeOffers },
    stages: columns.map((c) => ({
      pipeline: c.pipeline?.name ?? '',
      stage: c.title,
      deals: c.deals.length,
      totalValue: round(c.deals.reduce((s, d) => s + (d.dealValue ?? 0), 0)),
    })),
  };
}

async function searchDeals(input: Record<string, any>) {
  const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 100);
  const query: string | undefined = input.query?.trim() || undefined;

  const where: Record<string, unknown> = { parentDealId: null };
  const storeFilter: Record<string, unknown> = {};

  if (query) {
    // Magasins résolus sur les clés normalisées (accents, casse et ponctuation
    // ignorés), pour que « saint loudeac » retrouve « Saint-Loudéac ».
    const storeIds = await findStoreIdsMatchingSearch(query);
    if (storeIds) where.storeId = { in: storeIds };
  }
  if (input.brandName?.trim()) {
    storeFilter.brand = { name: { contains: input.brandName.trim(), mode: 'insensitive' } };
  }
  if (Object.keys(storeFilter).length) where.store = storeFilter;
  if (input.columnTitle?.trim()) {
    where.column = { title: { contains: input.columnTitle.trim(), mode: 'insensitive' } };
  }
  if (input.priority?.trim()) where.priority = { equals: input.priority.trim(), mode: 'insensitive' };

  const deals = await prisma.deal.findMany({
    where,
    take: limit,
    orderBy: { updatedAt: 'desc' },
    select: {
      priority: true,
      dealValue: true,
      directeur: true,
      contactCalling: true,
      contactLastName: true,
      demoDate: true,
      closingDate: true,
      column: { select: { title: true } },
      store: { select: { name: true, city: true, department: true, brand: { select: { name: true } } } },
    },
  });

  const totalMatching = await prisma.deal.count({ where });

  return {
    totalMatching,
    returned: deals.length,
    deals: deals.map((d) => ({
      store: d.store?.name ?? '',
      city: d.store?.city ?? '',
      department: d.store?.department ?? '',
      brand: d.store?.brand?.name ?? 'Sans enseigne',
      stage: d.column?.title ?? '',
      priority: d.priority,
      value: d.dealValue ?? null,
      directeur: d.directeur || null,
      contact: [d.contactCalling, d.contactLastName].filter(Boolean).join(' ') || null,
      demoDate: d.demoDate?.toISOString().slice(0, 10) ?? null,
      closingDate: d.closingDate?.toISOString().slice(0, 10) ?? null,
    })),
  };
}

async function getActions(input: Record<string, any>) {
  const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 100);
  const status: string = input.status === 'done' ? 'done' : 'todo';
  const scope: string = input.scope ?? 'all';

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const where: Record<string, unknown> = { status };
  if (scope === 'overdue') where.dueDate = { lt: startOfToday };
  else if (scope === 'today') where.dueDate = { gte: startOfToday, lt: endOfToday };
  else if (scope === 'upcoming') where.dueDate = { gte: endOfToday };

  const [total, actions] = await Promise.all([
    prisma.action.count({ where }),
    prisma.action.findMany({
      where,
      take: limit,
      orderBy: { dueDate: 'asc' },
      select: {
        title: true,
        type: true,
        dueDate: true,
        dueTime: true,
        priority: true,
        assignedUser: { select: { name: true } },
        deal: { select: { store: { select: { name: true, city: true } } } },
      },
    }),
  ]);

  return {
    filter: { status, scope },
    total,
    returned: actions.length,
    actions: actions.map((a) => ({
      title: a.title,
      type: a.type,
      dueDate: a.dueDate.toISOString().slice(0, 10),
      dueTime: a.dueTime || null,
      priority: a.priority,
      assignedTo: a.assignedUser?.name ?? null,
      store: a.deal?.store?.name ?? '',
      city: a.deal?.store?.city ?? '',
    })),
  };
}

async function getBrands() {
  const brands = await prisma.brand.findMany({
    orderBy: { name: 'asc' },
    select: {
      name: true,
      stores: { select: { id: true, deal: { select: { id: true } } } },
    },
  });

  return {
    brands: brands
      .map((b) => ({
        name: b.name,
        stores: b.stores.length,
        deals: b.stores.filter((s) => s.deal).length,
      }))
      .sort((a, b) => b.deals - a.deals),
  };
}
