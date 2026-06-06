// ⚠️ MODE DÉMO (branche design) ----------------------------------------------
// Quand la base de données est injoignable (preview sans DB), les routes API et
// la page pipeline retombent sur ces données fictives au lieu de planter, afin
// de pouvoir visualiser l'interface (et notamment le drawer d'affaire).
// À RETIRER avant la mise en prod.

export const DEMO_MODE = true;

const PIPELINE_ID = 'demo-pipe';

export const demoColumns = [
  { id: 'col-1', pipelineId: PIPELINE_ID, title: 'SOURCING A FAIRE', position: 0, color: '#94a3b8', isDefault: true },
  { id: 'col-2', pipelineId: PIPELINE_ID, title: 'SOURCING TERMINE', position: 1, color: '#6366f1', isDefault: false },
  { id: 'col-3', pipelineId: PIPELINE_ID, title: 'PROSPECTION VALEUR', position: 2, color: '#0ea5e9', isDefault: false },
  { id: 'col-4', pipelineId: PIPELINE_ID, title: 'RDV PLANIFIE', position: 3, color: '#f59e0b', isDefault: false },
  { id: 'col-5', pipelineId: PIPELINE_ID, title: 'DEMO FAITE', position: 4, color: '#10b981', isDefault: false },
  { id: 'col-6', pipelineId: PIPELINE_ID, title: 'RELANCE 1', position: 5, color: '#ec4899', isDefault: false },
  { id: 'col-7', pipelineId: PIPELINE_ID, title: 'GAGNÉ', position: 6, color: '#16a34a', isDefault: false },
];

export const demoPipelines = [{ id: PIPELINE_ID, name: 'Pipeline démo', position: 0, color: '#6366f1', columns: demoColumns }];

export const demoUsers = [
  { id: 'user-1', name: 'Hugo Abdelhadi', color: '#6366f1' },
  { id: 'user-2', name: 'Bilal Yacouti', color: '#0ea5e9' },
];

export const demoCollaborators = [
  { id: 'collab-1', name: 'Adrien Fonte', email: 'adrien@swipelink.io', color: '#f59e0b' },
];

export const demoBrands = [
  { id: 'brand-1', name: 'Super U', color: '#f59e0b' },
  { id: 'brand-2', name: 'Leclerc', color: '#2563eb' },
  { id: 'brand-3', name: 'Intermarché', color: '#e11d48' },
];

export const demoTemplates = [
  { id: 'tpl-1', name: 'Prise de contact', subject: 'Recrutement chez {{nom_magasin}}', body: 'Bonjour {{civilite}} {{directeur}},\n\nJe me permets de vous contacter concernant vos recrutements.\n\nCordialement,' },
  { id: 'tpl-2', name: 'Relance', subject: 'Suite à notre échange — {{nom_magasin}}', body: 'Bonjour {{civilite}} {{directeur}},\n\nJe reviens vers vous suite à notre dernier échange.\n\nBien à vous,' },
];

function iso(d: string) { return new Date(d + 'T10:00:00Z').toISOString(); }

interface DemoDealSeed {
  id: string; columnId: string; brand: typeof demoBrands[number] | null;
  storeName: string; city: string; department: string;
  directeur: string; contactCalling: string; dealEmail: string; contactLastName: string;
  dealValue: number | null; demoDate: string | null; candidateCallDate: string | null;
  assignedUser?: typeof demoUsers[number]; collaborator?: typeof demoCollaborators[number];
  isNew?: boolean;
  jobOffers: { jobTitle: string; title?: string; contractType?: string; salary?: string; source?: string; status?: string }[];
  notes: { content: string; authorName: string; createdAt: string }[];
  actions: { title: string; type: string; dueDate: string; dueTime?: string; status: string; priority?: string; note?: string; completedAt?: string; assignedUser?: typeof demoUsers[number] }[];
  emails: { to: string; subject: string; body: string; status: string; sentAt: string; openedAt?: string; template?: { name: string } }[];
}

const seeds: DemoDealSeed[] = [
  {
    id: 'deal-1', columnId: 'col-3', brand: demoBrands[0],
    storeName: 'Super U Eysines', city: 'Eysines', department: 'Gironde (33)',
    directeur: 'Adrien Fonte', contactCalling: 'Adrien Fonte', dealEmail: 'direction@superu-eysines.fr', contactLastName: 'Fonte',
    dealValue: 4500, demoDate: '2026-06-12', candidateCallDate: '2026-06-09',
    assignedUser: demoUsers[0], collaborator: demoCollaborators[0],
    jobOffers: [
      { jobTitle: 'Boucher', contractType: 'CDI', salary: '2200€', source: 'Indeed', status: 'active' },
      { jobTitle: 'Hôte de caisse', contractType: 'CDD', salary: 'SMIC', source: 'HelloWork', status: 'active' },
    ],
    notes: [
      { content: "Premier contact très positif. Le directeur cherche à recruter 3 bouchers avant l'été.", authorName: 'Hugo Abdelhadi', createdAt: iso('2026-05-22') },
      { content: 'Relancé par téléphone, demande un devis détaillé.', authorName: 'Bilal Yacouti', createdAt: iso('2026-05-27') },
    ],
    actions: [
      { title: 'Lancer la prospection valeur', type: 'Appeler', dueDate: iso('2026-06-02'), status: 'todo', priority: 'élevée', note: 'En retard — à relancer rapidement', assignedUser: demoUsers[0] },
      { title: 'Envoyer le devis', type: 'Email', dueDate: iso('2026-06-06'), dueTime: '14:30', status: 'todo', priority: 'normale', assignedUser: demoUsers[0] },
      { title: 'Préparer la démo produit', type: 'Démo', dueDate: iso('2026-06-11'), status: 'todo', priority: 'normale' },
      { title: 'Appel de qualification', type: 'Appeler', dueDate: iso('2026-05-20'), status: 'done', completedAt: iso('2026-05-20'), assignedUser: demoUsers[0] },
    ],
    emails: [
      { to: 'direction@superu-eysines.fr', subject: 'Recrutement chez Super U Eysines', body: 'Bonjour Monsieur Fonte,\n\nJe me permets de vous contacter concernant vos recrutements de bouchers.\n\nCordialement,\nHugo', status: 'opened', sentAt: iso('2026-05-21'), openedAt: iso('2026-05-21'), template: { name: 'Prise de contact' } },
      { to: 'direction@superu-eysines.fr', subject: 'Suite à notre échange — Super U Eysines', body: 'Bonjour Monsieur Fonte,\n\nComme convenu, voici quelques informations complémentaires.\n\nBien à vous,', status: 'sent', sentAt: iso('2026-05-28'), template: { name: 'Relance' } },
    ],
  },
  {
    id: 'deal-2', columnId: 'col-2', brand: demoBrands[2],
    storeName: 'Intermarché Veuzain-sur-Loire', city: 'Veuzain-sur-Loire', department: 'Loir-et-Cher (41)',
    directeur: 'Jordan Mercier', contactCalling: 'Jordan Mercier', dealEmail: 'contact@itm-veuzain.fr', contactLastName: 'Mercier',
    dealValue: 3200, demoDate: null, candidateCallDate: null, assignedUser: demoUsers[1],
    isNew: true,
    jobOffers: [{ jobTitle: 'Responsable rayon', contractType: 'CDI', status: 'active' }],
    notes: [], actions: [{ title: 'Premier appel', type: 'Appeler', dueDate: iso('2026-06-08'), status: 'todo', priority: 'normale' }], emails: [],
  },
  {
    id: 'deal-3', columnId: 'col-2', brand: demoBrands[0],
    storeName: 'Super U Saint Fulgent', city: 'Saint-Fulgent', department: 'Vendée (85)',
    directeur: 'Morgane Lefèvre', contactCalling: 'Morgane Lefèvre', dealEmail: 'rh@superu-stfulgent.fr', contactLastName: 'Lefèvre',
    dealValue: null, demoDate: null, candidateCallDate: null,
    jobOffers: [], notes: [], actions: [], emails: [],
  },
  {
    id: 'deal-4', columnId: 'col-4', brand: demoBrands[0],
    storeName: 'Super U Dol de Bretagne', city: 'Dol-de-Bretagne', department: 'Ille-et-Vilaine (35)',
    directeur: 'Kévin Tanguy', contactCalling: 'Kévin Tanguy', dealEmail: 'direction@superu-dol.fr', contactLastName: 'Tanguy',
    dealValue: 5200, demoDate: '2026-06-15', candidateCallDate: null, assignedUser: demoUsers[0], collaborator: demoCollaborators[0],
    jobOffers: [{ jobTitle: 'Boulanger', contractType: 'CDI', salary: '2400€', status: 'active' }],
    notes: [{ content: 'RDV planifié pour la démo.', authorName: 'Hugo Abdelhadi', createdAt: iso('2026-06-01') }],
    actions: [{ title: 'Confirmer le RDV', type: 'Appeler', dueDate: iso('2026-06-13'), status: 'todo', priority: 'élevée' }], emails: [],
  },
  {
    id: 'deal-5', columnId: 'col-2', brand: demoBrands[1],
    storeName: 'Leclerc Biars sur Cère', city: 'Biars-sur-Cère', department: 'Lot (46)',
    directeur: 'Dominique Roussel', contactCalling: 'Dominique Roussel', dealEmail: 'contact@leclerc-biars.fr', contactLastName: 'Roussel',
    dealValue: null, demoDate: null, candidateCallDate: null,
    jobOffers: [{ jobTitle: 'Poissonnier', status: 'active' }], notes: [], actions: [], emails: [],
  },
  {
    id: 'deal-6', columnId: 'col-5', brand: demoBrands[0],
    storeName: 'Super U Dol de Bretagne 2', city: 'Combourg', department: 'Ille-et-Vilaine (35)',
    directeur: 'Sophie Bernard', contactCalling: 'Sophie Bernard', dealEmail: 'rh@superu-combourg.fr', contactLastName: 'Bernard',
    dealValue: 6800, demoDate: '2026-05-30', candidateCallDate: '2026-06-04', assignedUser: demoUsers[1],
    jobOffers: [], notes: [{ content: 'Démo réalisée, en attente de retour.', authorName: 'Bilal Yacouti', createdAt: iso('2026-05-31') }],
    actions: [{ title: 'Relancer après démo', type: 'Relancer', dueDate: iso('2026-06-09'), status: 'todo', priority: 'normale' }], emails: [],
  },
];

function buildDeal(s: DemoDealSeed) {
  const column = demoColumns.find(c => c.id === s.columnId)!;
  const store = {
    id: `store-${s.id}`, brandId: s.brand?.id || null, brand: s.brand,
    name: s.storeName, city: s.city, department: s.department,
    postalCode: '', address: '', phone: '', email: '', siret: '',
  };
  const jobOffers = s.jobOffers.map((o, i) => ({
    id: `offer-${s.id}-${i}`, dealId: s.id, storeId: store.id,
    title: o.title || o.jobTitle, jobTitle: o.jobTitle, contractType: o.contractType || '',
    salary: o.salary || '', source: o.source || '', url: '', status: o.status || 'active',
    firstSeenAt: iso('2026-05-15'), lastSeenAt: iso('2026-06-05'),
  }));
  const actions = s.actions.map((a, i) => ({
    id: `action-${s.id}-${i}`, dealId: s.id, title: a.title, type: a.type,
    dueDate: a.dueDate, dueTime: a.dueTime || '', status: a.status, priority: a.priority || 'normale',
    note: a.note || '', completedAt: a.completedAt || null,
    assignedUserId: a.assignedUser?.id || null, assignedUser: a.assignedUser || null,
    createdAt: iso('2026-05-15'), updatedAt: a.completedAt || a.dueDate,
  }));
  const notes = s.notes.map((n, i) => ({
    id: `note-${s.id}-${i}`, dealId: s.id, content: n.content,
    authorName: n.authorName, authorId: null, createdAt: n.createdAt, updatedAt: n.createdAt,
  }));
  return {
    id: s.id, pipelineId: PIPELINE_ID, storeId: store.id, store,
    columnId: s.columnId, column, previousColumnId: null,
    priority: 'normale', position: 0,
    isNewFromLastImport: !!s.isNew, hasNewOfferFromLastImport: false, isPresentInLastImport: true,
    movedToCallAt: null, lastImportAt: iso('2026-06-05'),
    directeur: s.directeur, contactCalling: s.contactCalling, dealEmail: s.dealEmail,
    contactCivilite: 'Monsieur', contactLastName: s.contactLastName,
    dealValue: s.dealValue, demoDate: s.demoDate ? iso(s.demoDate) : null,
    candidateCallDate: s.candidateCallDate ? iso(s.candidateCallDate) : null,
    collaboratorId: s.collaborator?.id || null, collaborator: s.collaborator || null,
    assignedUserId: s.assignedUser?.id || null, assignedUser: s.assignedUser || null,
    createdAt: iso('2026-05-15'), updatedAt: iso('2026-06-05'),
    jobOffers, actions, notes,
    _emails: s.emails.map((e, i) => ({ id: `email-${s.id}-${i}`, dealId: s.id, ...e })),
    _count: { jobOffers: jobOffers.length, actions: actions.filter(a => a.status === 'todo').length },
  };
}

const demoDealsFull = seeds.map(buildDeal);

/** Liste des affaires (pour le board) : action « todo » la plus proche en premier, take 1. */
export function demoDealList() {
  return demoDealsFull.map(d => ({
    ...d,
    actions: d.actions.filter(a => a.status === 'todo').sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).slice(0, 1),
  }));
}

/** Détail d'une affaire (pour le drawer). */
export function getDemoDeal(id: string) {
  return demoDealsFull.find(d => d.id === id) || demoDealsFull[0];
}

/** Emails d'une affaire (les plus récents en premier). */
export function demoEmails(dealId: string) {
  const d = demoDealsFull.find(x => x.id === dealId) || demoDealsFull[0];
  return [...d._emails].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
}
