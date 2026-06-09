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
  { id: 'c7', title: 'Signé',       position: 2, color: '#10b981', isDefault: false, createdAt: NOW, updatedAt: NOW },
];

export const mockPipelines = [
  { id: 'p1', name: 'Prospection', position: 0, color: '#6366f1', createdAt: NOW, updatedAt: NOW, columns: p1Columns },
  { id: 'p2', name: 'Closing',     position: 1, color: '#ec4899', createdAt: NOW, updatedAt: NOW, columns: p2Columns },
];

export const mockColumns = [...p1Columns, ...p2Columns];

// ─── Magasins, offres et affaires ─────────────────────────────────────────────
function makeStore(id: string, brand: typeof mockBrands[number], name: string, city: string, department: string) {
  return {
    id, brandId: brand.id, brand, name, normalizedName: name.toLowerCase(),
    city, postalCode: '', department, address: '', phone: '', email: '',
    siret: '', externalId: '', deduplicationKey: id,
    latitude: null, longitude: null, geocodedAt: null, geocodeQuery: '',
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
    dealValue: null, demoDate: null, candidateCallDate: null,
    assignedUserId: spec.user?.id ?? null, assignedUser: spec.user ?? null, collaborator: null,
    createdAt: NOW, updatedAt: NOW, jobOffers: offers, actions: [], notes: [],
    _count: { jobOffers: offers.length, actions: 0 },
  };
}

const [leclerc, inter, superu, carrefour] = mockBrands;

export const mockDeals = [
  // Pipeline « Prospection »
  makeDeal({ pipelineId: 'p1', columnId: 'c1', contact: '06 12 34 56 78', user: mockUsers[0],
    store: makeStore('s1', leclerc, 'E.Leclerc Lanester', 'Lanester', '56'), offers: ['Boucher', 'Caissier'] }),
  makeDeal({ pipelineId: 'p1', columnId: 'c1', contact: '06 98 76 54 32',
    store: makeStore('s2', inter, 'Intermarché Vannes', 'Vannes', '56'), offers: ['Employé libre-service'] }),
  makeDeal({ pipelineId: 'p1', columnId: 'c1', contact: '07 11 22 33 44', user: mockUsers[1],
    store: makeStore('s3', superu, 'Super U Auray', 'Auray', '56') }),
  makeDeal({ pipelineId: 'p1', columnId: 'c2', contact: '06 55 44 33 22', user: mockUsers[0],
    store: makeStore('s4', carrefour, 'Carrefour Quimper', 'Quimper', '29'), offers: ['Manager rayon'] }),
  makeDeal({ pipelineId: 'p1', columnId: 'c2', contact: '06 00 11 22 33', user: mockUsers[2],
    store: makeStore('s5', leclerc, 'E.Leclerc Brest', 'Brest', '29') }),
  makeDeal({ pipelineId: 'p1', columnId: 'c3', contact: '07 88 99 00 11', user: mockUsers[1], priority: 'élevée',
    store: makeStore('s6', inter, 'Intermarché Lorient', 'Lorient', '56'), offers: ['Hôte de caisse', 'Boulanger', 'Poissonnier'] }),
  makeDeal({ pipelineId: 'p1', columnId: 'c3', contact: '06 44 55 66 77', user: mockUsers[0],
    store: makeStore('s7', superu, 'Super U Pontivy', 'Pontivy', '56') }),
  makeDeal({ pipelineId: 'p1', columnId: 'c4', contact: '07 33 22 11 00', user: mockUsers[2], priority: 'normale',
    store: makeStore('s8', carrefour, 'Carrefour Rennes', 'Rennes', '35'), offers: ['Directeur adjoint'] }),
  // Pipeline « Closing »
  makeDeal({ pipelineId: 'p2', columnId: 'c5', contact: '06 12 12 12 12', user: mockUsers[0],
    store: makeStore('s9', leclerc, 'E.Leclerc Nantes', 'Nantes', '44'), offers: ['Responsable RH'] }),
  makeDeal({ pipelineId: 'p2', columnId: 'c6', contact: '06 34 34 34 34', user: mockUsers[1], priority: 'urgente',
    store: makeStore('s10', inter, 'Intermarché Angers', 'Angers', '49') }),
  makeDeal({ pipelineId: 'p2', columnId: 'c7', contact: '06 56 56 56 56', user: mockUsers[2],
    store: makeStore('s11', superu, 'Super U Le Mans', 'Le Mans', '72'), offers: ['Chef de rayon'] }),
];
