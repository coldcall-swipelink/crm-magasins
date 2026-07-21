// Données fictives pour prévisualiser le design SANS base de données.
//
// Activé automatiquement sur les déploiements de PREVIEW Vercel
// (VERCEL_ENV === 'preview') — la production n'est jamais affectée.
// On peut forcer/désactiver explicitement via la variable USE_MOCK_DATA
// ('true' pour forcer partout, 'false' pour désactiver même en preview).
export const USE_MOCK_DATA =
  process.env.USE_MOCK_DATA === 'true' ||
  (process.env.VERCEL_ENV === 'preview' && process.env.USE_MOCK_DATA !== 'false');

const NOW = '2026-06-09T10:00:00.000Z';

// ─── Utilisateurs ───────────────────────────────────────────────────────────
export const mockUsers = [
  { id: 'u1', name: 'Bilal Yacouti', color: '#6366f1', createdAt: NOW, updatedAt: NOW },
  { id: 'u2', name: 'Sophie Martin',  color: '#ec4899', createdAt: NOW, updatedAt: NOW },
  { id: 'u3', name: 'Karim Benali',   color: '#10b981', createdAt: NOW, updatedAt: NOW },
];

// ─── Enseignes ──────────────────────────────────────────────────────────────
export const mockBrands = [
  { id: 'b1', name: 'E.Leclerc',    color: '#0066cc', createdAt: NOW, updatedAt: NOW, _count: { stores: 12 } },
  { id: 'b2', name: 'Intermarché',  color: '#e11d48', createdAt: NOW, updatedAt: NOW, _count: { stores: 9 } },
  { id: 'b3', name: 'Super U',      color: '#2563eb', createdAt: NOW, updatedAt: NOW, _count: { stores: 7 } },
  { id: 'b4', name: 'Carrefour',    color: '#1d4ed8', createdAt: NOW, updatedAt: NOW, _count: { stores: 5 } },
];

// ─── Colonnes & pipelines ─────────────────────────────────────────────────────
const p1Columns = [
  { id: 'c1', title: 'À contacter', position: 0, color: '#6366f1', isDefault: true,  createdAt: NOW, updatedAt: NOW },
  { id: 'c2', title: 'Contacté',    position: 1, color: '#0ea5e9', isDefault: false, createdAt: NOW, updatedAt: NOW },
  { id: 'c3', title: 'Démo prévue', position: 2, color: '#f59e0b', isDefault: false, createdAt: NOW, updatedAt: NOW },
  { id: 'c4', title: 'Gagné',       position: 3, color: '#10b981', isDefault: false, createdAt: NOW, updatedAt: NOW },
];
const p2Columns = [
  { id: 'c5', title: 'Démo prévue', position: 0, color: '#f59e0b', isDefault: true,  createdAt: NOW, updatedAt: NOW },
  { id: 'c6', title: 'Négociation', position: 1, color: '#8b5cf6', isDefault: false, createdAt: NOW, updatedAt: NOW },
  { id: 'c8', title: 'SMARTLINKÉ',  position: 2, color: '#10b981', isDefault: false, createdAt: NOW, updatedAt: NOW },
  { id: 'c7', title: 'Signé',       position: 3, color: '#84cc16', isDefault: false, createdAt: NOW, updatedAt: NOW },
];

export const mockPipelines = [
  { id: 'p1', name: 'Prospection', position: 0, color: '#6366f1', createdAt: NOW, updatedAt: NOW, columns: p1Columns },
  { id: 'p2', name: 'Closing',     position: 1, color: '#ec4899', createdAt: NOW, updatedAt: NOW, columns: p2Columns },
];

export const mockColumns = [...p1Columns, ...p2Columns];

// ─── Magasins, offres et affaires ─────────────────────────────────────────────
function makeStore(id: string, brand: typeof mockBrands[number], name: string, city: string, department: string, coords?: [number, number]) {
  return {
    id, brandId: brand.id, brand, name, normalizedName: name.toLowerCase(),
    city, postalCode: '', department, address: '', phone: '', email: '',
    siret: '', externalId: '', deduplicationKey: id,
    latitude: coords ? coords[0] : null as number | null,
    longitude: coords ? coords[1] : null as number | null,
    geocodedAt: null, geocodeQuery: '',
    createdAt: NOW, updatedAt: NOW,
  };
}

let offerSeq = 0;
function makeOffer(jobTitle: string) {
  const id = `o${++offerSeq}`;
  return {
    id, dealId: '', storeId: '', importBatchId: '', externalOfferId: '',
    title: jobTitle, jobTitle, contractType: 'CDI', salary: '', source: '',
    url: '', publishedAt: '', fingerprint: id, firstSeenAt: NOW, lastSeenAt: NOW,
    createdAt: NOW, updatedAt: NOW,
  };
}

interface DealSpec {
  pipelineId: string;
  columnId: string;
  store: ReturnType<typeof makeStore>;
  contact: string;
  user?: typeof mockUsers[number];
  offers?: string[];
  priority?: string;
  dealValue?: number | null;
}

let dealSeq = 0;
function makeDeal(spec: DealSpec) {
  const id = `d${++dealSeq}`;
  const offers = (spec.offers ?? []).map(makeOffer);
  return {
    id, pipelineId: spec.pipelineId, storeId: spec.store.id, store: spec.store,
    columnId: spec.columnId, column: mockColumns.find(c => c.id === spec.columnId) ?? null,
    previousColumnId: null, priority: spec.priority ?? 'normale', position: dealSeq,
    isNewFromLastImport: false, hasNewOfferFromLastImport: false, isPresentInLastImport: true,
    movedToCallAt: null, lastImportAt: null, directeur: '', contactCalling: spec.contact,
    dealEmail: '', contactCivilite: 'Monsieur', contactLastName: '',
    dealValue: spec.dealValue ?? null, demoDate: null, candidateCallDate: null,
    assignedUserId: spec.user?.id ?? null, assignedUser: spec.user ?? null, collaborator: null,
    // Regroupement d'affaires : parentDealId pointe vers le deal qui absorbe
    // celui-ci ; childDeals liste les sous-deals absorbés (rempli plus bas).
    parentDealId: null as string | null,
    childDeals: [] as { id: string; dealValue: number | null }[],
    createdAt: NOW, updatedAt: NOW, jobOffers: offers, actions: [], notes: [],
    _count: { jobOffers: offers.length, actions: 0, childDeals: 0 },
  };
}

const [leclerc, inter, superu, carrefour] = mockBrands;

export const mockDeals = [
  // Pipeline « Prospection » — coordonnées réelles pour tester « Magasins proches ».
  // Le Morbihan (Lanester, Lorient, Auray, Vannes, Pontivy) est groupé < 50 km.
  makeDeal({ pipelineId: 'p1', columnId: 'c1', contact: '06 12 34 56 78', user: mockUsers[0],
    store: makeStore('s1', leclerc, 'E.Leclerc Lanester', 'Lanester', '56', [47.76, -3.34]), offers: ['Boucher', 'Caissier'] }),
  makeDeal({ pipelineId: 'p1', columnId: 'c1', contact: '06 98 76 54 32',
    store: makeStore('s2', inter, 'Intermarché Vannes', 'Vannes', '56', [47.658, -2.76]), offers: ['Employé libre-service'] }),
  makeDeal({ pipelineId: 'p1', columnId: 'c1', contact: '07 11 22 33 44', user: mockUsers[1],
    store: makeStore('s3', superu, 'Super U Auray', 'Auray', '56', [47.668, -2.98]) }),
  makeDeal({ pipelineId: 'p1', columnId: 'c2', contact: '06 55 44 33 22', user: mockUsers[0],
    store: makeStore('s4', carrefour, 'Carrefour Quimper', 'Quimper', '29', [47.996, -4.10]), offers: ['Manager rayon'] }),
  makeDeal({ pipelineId: 'p1', columnId: 'c2', contact: '06 00 11 22 33', user: mockUsers[2],
    store: makeStore('s5', leclerc, 'E.Leclerc Brest', 'Brest', '29', [48.39, -4.49]) }),
  makeDeal({ pipelineId: 'p1', columnId: 'c3', contact: '07 88 99 00 11', user: mockUsers[1], priority: 'élevée',
    store: makeStore('s6', inter, 'Intermarché Lorient', 'Lorient', '56', [47.748, -3.37]), offers: ['Hôte de caisse', 'Boulanger', 'Poissonnier'] }),
  makeDeal({ pipelineId: 'p1', columnId: 'c3', contact: '06 44 55 66 77', user: mockUsers[0],
    store: makeStore('s7', superu, 'Super U Pontivy', 'Pontivy', '56', [48.069, -2.96]) }),
  makeDeal({ pipelineId: 'p1', columnId: 'c4', contact: '07 33 22 11 00', user: mockUsers[2], priority: 'normale',
    store: makeStore('s8', carrefour, 'Carrefour Rennes', 'Rennes', '35', [48.117, -1.68]), offers: ['Directeur adjoint'] }),
  // Pipeline « Closing »
  makeDeal({ pipelineId: 'p2', columnId: 'c5', contact: '06 12 12 12 12', user: mockUsers[0],
    store: makeStore('s9', leclerc, 'E.Leclerc Nantes', 'Nantes', '44', [47.218, -1.55]), offers: ['Responsable RH'] }),
  makeDeal({ pipelineId: 'p2', columnId: 'c6', contact: '06 34 34 34 34', user: mockUsers[1], priority: 'urgente',
    store: makeStore('s10', inter, 'Intermarché Angers', 'Angers', '49', [47.47, -0.55]) }),
  makeDeal({ pipelineId: 'p2', columnId: 'c7', contact: '06 56 56 56 56', user: mockUsers[2],
    store: makeStore('s11', superu, 'Super U Le Mans', 'Le Mans', '72', [48.00, 0.20]), offers: ['Chef de rayon'] }),
  // Exemple de regroupement : « Intermarché La Teste de Buch » (parent) absorbe
  // « Intermarché Arcachon » (sous-deal). Le sous-deal n'apparaît PAS dans le
  // pipeline mais reste ouvrable / cherchable, et sa valeur se cumule au parent.
  // Tous deux sur le bassin d'Arcachon (< 50 km) pour tester « Magasins proches ».
  makeDeal({ pipelineId: 'p1', columnId: 'c2', contact: '06 77 88 99 00', user: mockUsers[0], priority: 'élevée',
    store: makeStore('s12', inter, 'Intermarché La Teste de Buch', 'La Teste-de-Buch', '33', [44.631, -1.146]), offers: ['Boucher', 'Caissier'], dealValue: 8000 }),
  makeDeal({ pipelineId: 'p1', columnId: 'c1', contact: '06 77 88 99 01',
    store: makeStore('s13', inter, 'Intermarché Arcachon', 'Arcachon', '33', [44.658, -1.168]), offers: ['Employé libre-service'], dealValue: 5000 }),
];

// ─── Câblage du regroupement d'affaires (parent ↔ sous-deals) ─────────────────
function wireDealGroup(parentId: string, childIds: string[]) {
  const parent = mockDeals.find(d => d.id === parentId);
  if (!parent) return;
  for (const childId of childIds) {
    const child = mockDeals.find(d => d.id === childId);
    if (!child) continue;
    child.parentDealId = parentId;
    parent.childDeals.push({ id: child.id, dealValue: child.dealValue });
  }
  parent._count.childDeals = parent.childDeals.length;
}
// Intermarché La Teste de Buch (d12) absorbe Intermarché Arcachon (d13).
wireDealGroup('d12', ['d13']);

// ─── Abonnements (onglet « Paiements ») ───────────────────────────────────────
// En preview (mock), impossible de créer un abonnement depuis l'UI : on
// pré-remplit donc des affaires « SMARTLINKÉ » (pipeline Closing) portant chacune
// un abonnement, une par règle de paiement, pour alimenter l'onglet Paiements et
// le closing du Dashboard. `closingDate` en 2026 pour générer des échéances à
// venir. Les montants suivent les règles (cf. src/lib/payments.ts).
interface MockSubSpec {
  storeId: string; storeName: string; city: string; department: string;
  brand: typeof mockBrands[number]; contact: string;
  type: string; timing: 'mensuel' | 'comptant'; mode: 'stripe' | 'virement';
  value: number; closingDate: string;
}

const SUBSCRIBED: MockSubSpec[] = [
  { storeId: 's14', storeName: 'E.Leclerc Nantes Atlantis', city: 'Saint-Herblain', department: '44', brand: leclerc,   contact: '06 10 10 10 10', type: '1 crédit par mois', timing: 'mensuel',  mode: 'stripe',   value: 100, closingDate: '2026-05-15' },
  { storeId: 's15', storeName: 'Intermarché Vannes Ouest', city: 'Vannes',          department: '56', brand: inter,     contact: '06 20 20 20 20', type: '1 crédit par mois', timing: 'comptant', mode: 'virement', value: 100, closingDate: '2026-02-10' },
  { storeId: 's16', storeName: 'Super U Quimper Sud',      city: 'Quimper',         department: '29', brand: superu,    contact: '06 30 30 30 30', type: '2 crédit par mois', timing: 'mensuel',  mode: 'stripe',   value: 150, closingDate: '2026-04-01' },
  { storeId: 's17', storeName: 'Carrefour Rennes Est',     city: 'Rennes',          department: '35', brand: carrefour, contact: '06 40 40 40 40', type: '4 crédit par an',   timing: 'mensuel',  mode: 'stripe',   value: 300, closingDate: '2026-06-01' },
  { storeId: 's18', storeName: 'E.Leclerc Brest Iroise',   city: 'Brest',           department: '29', brand: leclerc,   contact: '06 50 50 50 50', type: '6 crédit par an',   timing: 'mensuel',  mode: 'virement', value: 250, closingDate: '2026-03-20' },
  { storeId: 's19', storeName: 'Intermarché Lorient Port', city: 'Lorient',         department: '56', brand: inter,     contact: '06 60 60 60 60', type: '2 crédit par an',   timing: 'mensuel',  mode: 'stripe',   value: 400, closingDate: '2026-06-20' },
  { storeId: 's20', storeName: 'Super U Auray Centre',     city: 'Auray',           department: '56', brand: superu,    contact: '06 70 70 70 70', type: '1 crédit par an',   timing: 'mensuel',  mode: 'virement', value: 500, closingDate: '2026-01-15' },
  { storeId: 's21', storeName: 'Carrefour Nantes Beaulieu',city: 'Nantes',          department: '44', brand: carrefour, contact: '06 80 80 80 80', type: '10 crédit par an',  timing: 'comptant', mode: 'stripe',   value: 120, closingDate: '2026-05-01' },
  { storeId: 's22', storeName: 'E.Leclerc Rennes Nord',    city: 'Rennes',          department: '35', brand: leclerc,   contact: '06 90 90 90 90', type: 'multidiffusion',    timing: 'comptant', mode: 'virement', value: 80,  closingDate: '2026-01-25' },
];

export interface MockSubscription {
  id: string; dealId: string; position: number; value: number | null; subscriptionType: string;
  paymentTiming: 'mensuel' | 'comptant'; paymentMode: 'stripe' | 'virement';
  closingDate: string | null; subscriptionMonths: number; subscriptionEndDate: string | null;
}

// Types d'abonnement (Paramètres) proposés dans le menu déroulant de la fiche
// affaire en preview. Reproduit les libellés utilisés par les règles de paiement.
export const mockSubscriptionTypes = [
  '1 crédit par mois', '2 crédit par mois', '3 crédit par mois',
  '4 crédit par an', '6 crédit par an', '2 crédit par an', '1 crédit par an',
  '10 crédit par an', 'multidiffusion',
].map((name, i) => ({ id: `st${i + 1}`, name, position: i, createdAt: NOW, updatedAt: NOW }));

export const mockSubscriptions: MockSubscription[] = [];

/** Ajoute `months` mois à une date ISO en gérant les fins de mois. Renvoie ISO. */
function addMonthsIso(iso: string | null, months: number): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return d.toISOString();
}

for (const s of SUBSCRIBED) {
  const deal = makeDeal({
    pipelineId: 'p2', columnId: 'c8', contact: s.contact,
    store: makeStore(s.storeId, s.brand, s.storeName, s.city, s.department),
    dealValue: s.value,
  });
  // Miroir dénormalisé lu par la carte / la fiche affaire.
  (deal as Record<string, unknown>).closingDate = s.closingDate;
  (deal as Record<string, unknown>).subscriptionType = s.type;
  (deal as Record<string, unknown>).paymentTiming = s.timing;
  (deal as Record<string, unknown>).paymentMode = s.mode;
  mockDeals.push(deal);
  const closingIso = new Date(s.closingDate).toISOString();
  mockSubscriptions.push({
    id: `sub-${deal.id}`, dealId: deal.id, position: 0, value: s.value, subscriptionType: s.type,
    paymentTiming: s.timing, paymentMode: s.mode, closingDate: closingIso, subscriptionMonths: 24,
    subscriptionEndDate: addMonthsIso(closingIso, 24),
  });
}

// ─── CRUD des abonnements en mémoire (mode preview / mock) ────────────────────
// Les routes API branchent sur ces helpers quand USE_MOCK_DATA est actif, pour
// que l'ajout / la modification / la suppression d'un abonnement fonctionne sans
// base de données (mutation en mémoire, comme le reste du mock).
let mockSubSeq = 0;

/** Recalcule les champs dénormalisés d'un deal mock à partir de ses abonnements. */
function recomputeMockDeal(dealId: string): void {
  const deal = mockDeals.find(d => d.id === dealId) as Record<string, unknown> | undefined;
  if (!deal) return;
  const subs = mockSubscriptions.filter(s => s.dealId === dealId).sort((a, b) => a.position - b.position);
  const primary = subs[0];
  const total = subs.reduce((sum, x) => sum + (x.value ?? 0), 0);
  deal.dealValue = subs.length ? total : null;
  deal.closingDate = primary?.closingDate ?? null;
  deal.paymentMode = primary?.paymentMode ?? 'stripe';
  deal.paymentTiming = primary?.paymentTiming ?? 'comptant';
  deal.subscriptionType = primary?.subscriptionType ?? '';
  deal.subscriptionMonths = primary?.subscriptionMonths ?? 12;
  deal.subscriptionEndDate = primary?.subscriptionEndDate ?? null;
}

/** Abonnements d'une affaire, triés par position. */
export function mockGetSubscriptions(dealId: string): MockSubscription[] {
  return mockSubscriptions.filter(s => s.dealId === dealId).sort((a, b) => a.position - b.position);
}

/** Crée un abonnement vide (max 3 / affaire). Renvoie l'abonnement ou une erreur. */
export function mockCreateSubscription(dealId: string): { sub?: MockSubscription; error?: string } {
  const existing = mockSubscriptions.filter(s => s.dealId === dealId);
  if (existing.length >= 3) return { error: 'Maximum 3 abonnements par affaire' };
  const sub: MockSubscription = {
    id: `sub-new-${++mockSubSeq}`, dealId, position: existing.length, value: null,
    subscriptionType: '', paymentTiming: 'comptant', paymentMode: 'stripe',
    closingDate: null, subscriptionMonths: 12, subscriptionEndDate: null,
  };
  mockSubscriptions.push(sub);
  recomputeMockDeal(dealId);
  return { sub };
}

/** Met à jour un abonnement mock (champs partiels). Renvoie l'abonnement à jour. */
export function mockUpdateSubscription(id: string, body: Record<string, unknown>): MockSubscription | null {
  const sub = mockSubscriptions.find(s => s.id === id);
  if (!sub) return null;
  if ('value' in body) sub.value = body.value === null || body.value === '' ? null : Number(body.value);
  if ('subscriptionType' in body) sub.subscriptionType = String(body.subscriptionType);
  if ('paymentMode' in body) sub.paymentMode = body.paymentMode === 'virement' ? 'virement' : 'stripe';
  if ('paymentTiming' in body) sub.paymentTiming = body.paymentTiming === 'mensuel' ? 'mensuel' : 'comptant';
  if ('closingDate' in body) sub.closingDate = body.closingDate ? new Date(body.closingDate as string).toISOString() : null;
  if ('subscriptionMonths' in body) sub.subscriptionMonths = Number(body.subscriptionMonths);
  sub.subscriptionEndDate = addMonthsIso(sub.closingDate, sub.subscriptionMonths || 12);
  recomputeMockDeal(sub.dealId);
  return sub;
}

/** Supprime un abonnement mock et renumérote les positions restantes. */
export function mockDeleteSubscription(id: string): boolean {
  const idx = mockSubscriptions.findIndex(s => s.id === id);
  if (idx === -1) return false;
  const { dealId } = mockSubscriptions[idx];
  mockSubscriptions.splice(idx, 1);
  mockSubscriptions.filter(s => s.dealId === dealId).sort((a, b) => a.position - b.position)
    .forEach((s, i) => { s.position = i; });
  recomputeMockDeal(dealId);
  return true;
}
