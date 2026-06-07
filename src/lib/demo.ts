// ⚠️ MODE DÉMO (branche design) ----------------------------------------------
// Quand la base de données est injoignable (preview sans DB), les routes API et
// la page pipeline retombent sur ces données fictives au lieu de planter, afin
// de pouvoir visualiser l'interface (et notamment le drawer d'affaire).
// À RETIRER avant la mise en prod.

export const DEMO_MODE = true;

const PIPELINE_ID = 'demo-pipe';
const PIPELINE_ID_2 = 'demo-pipe-2';

// Pipeline 1 : prospection
const pipe1Cols = [
  { id: 'col-1', pipelineId: PIPELINE_ID, title: 'SOURCING A FAIRE', position: 0, color: '#94a3b8', isDefault: true },
  { id: 'col-2', pipelineId: PIPELINE_ID, title: 'SOURCING TERMINE', position: 1, color: '#6366f1', isDefault: false },
  { id: 'col-3', pipelineId: PIPELINE_ID, title: 'PROSPECTION VALEUR', position: 2, color: '#0ea5e9', isDefault: false },
  { id: 'col-4', pipelineId: PIPELINE_ID, title: 'RDV PLANIFIE', position: 3, color: '#f59e0b', isDefault: false },
  { id: 'col-5', pipelineId: PIPELINE_ID, title: 'DEMO FAITE', position: 4, color: '#10b981', isDefault: false },
  { id: 'col-6', pipelineId: PIPELINE_ID, title: 'RELANCE 1', position: 5, color: '#ec4899', isDefault: false },
  { id: 'col-7', pipelineId: PIPELINE_ID, title: 'GAGNÉ', position: 6, color: '#16a34a', isDefault: false },
];

// Pipeline 2 : recrutement (pour tester le changement de pipeline)
const pipe2Cols = [
  { id: 'col2-1', pipelineId: PIPELINE_ID_2, title: 'CANDIDATS À APPELER', position: 0, color: '#94a3b8', isDefault: true },
  { id: 'col2-2', pipelineId: PIPELINE_ID_2, title: 'ENTRETIEN PLANIFIÉ', position: 1, color: '#0ea5e9', isDefault: false },
  { id: 'col2-3', pipelineId: PIPELINE_ID_2, title: 'ENTRETIEN FAIT', position: 2, color: '#f59e0b', isDefault: false },
  { id: 'col2-4', pipelineId: PIPELINE_ID_2, title: 'EMBAUCHÉ', position: 3, color: '#16a34a', isDefault: false },
];

export const demoColumns = [...pipe1Cols, ...pipe2Cols];

export const demoPipelines = [
  { id: PIPELINE_ID, name: 'Prospection', position: 0, color: '#6366f1', columns: pipe1Cols },
  { id: PIPELINE_ID_2, name: 'Recrutement', position: 1, color: '#10b981', columns: pipe2Cols },
];

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

const demoSeedDeals = seeds.map(buildDeal);

// Store mutable en mémoire : permet de conserver les déplacements / notes /
// actions / emails pendant la session de preview (pas de persistance en base).
// On le rattache à globalThis pour survivre aux rechargements de module.
type DemoDeal = ReturnType<typeof buildDeal>;
const globalForDemo = globalThis as unknown as { __demoDeals?: DemoDeal[] };
function store(): DemoDeal[] {
  if (!globalForDemo.__demoDeals) {
    globalForDemo.__demoDeals = JSON.parse(JSON.stringify(demoSeedDeals));
  }
  return globalForDemo.__demoDeals!;
}

/** Liste des affaires (pour le board) : action « todo » la plus proche en premier, take 1. */
export function demoDealList() {
  return store().map(d => ({
    ...d,
    actions: d.actions.filter(a => a.status === 'todo').sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).slice(0, 1),
  }));
}

/** Détail d'une affaire (pour le drawer). */
export function getDemoDeal(id: string) {
  return store().find(d => d.id === id) || store()[0];
}

/** Emails d'une affaire (les plus récents en premier). */
export function demoEmails(dealId: string) {
  const d = getDemoDeal(dealId);
  return [...d._emails].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
}

// ---- Mutations en mémoire (mode démo) --------------------------------------

export function demoMoveDeal(id: string, columnId: string) {
  const d = getDemoDeal(id);
  const col = demoColumns.find(c => c.id === columnId);
  if (col) { d.columnId = columnId; d.column = col; d.pipelineId = col.pipelineId; }
  return d;
}

export function demoPatchDeal(id: string, data: Record<string, any>) {
  const d = getDemoDeal(id);
  for (const [k, v] of Object.entries(data)) {
    (d as any)[k] = v;
    if (k === 'assignedUserId') d.assignedUser = demoUsers.find(u => u.id === v) || null;
    if (k === 'collaboratorId') d.collaborator = (demoCollaborators.find(c => c.id === v) as any) || null;
  }
  return d;
}

export function demoAddNote(dealId: string, content: string, authorName: string) {
  const d = getDemoDeal(dealId);
  const note = { id: `note-${Date.now()}`, dealId, content, authorName, authorId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  d.notes.unshift(note as any);
  return note;
}

export function demoSaveAction(dealId: string, payload: any) {
  const d = getDemoDeal(dealId);
  const user = demoUsers.find(u => u.id === payload.assignedUserId) || null;
  if (payload.id && String(payload.id).startsWith('action-')) {
    const a = d.actions.find(x => x.id === payload.id);
    if (a) {
      Object.assign(a, {
        title: payload.title ?? a.title, type: payload.type ?? a.type,
        dueDate: payload.dueDate ? new Date(payload.dueDate).toISOString() : a.dueDate,
        dueTime: payload.dueTime ?? a.dueTime, priority: payload.priority ?? a.priority,
        note: payload.note ?? a.note, assignedUserId: payload.assignedUserId || null, assignedUser: user,
      });
      return a;
    }
  }
  const action = {
    id: `action-${Date.now()}`, dealId, title: payload.title || '', type: payload.type || 'Appeler',
    dueDate: payload.dueDate ? new Date(payload.dueDate).toISOString() : new Date().toISOString(),
    dueTime: payload.dueTime || '', status: 'todo', priority: payload.priority || 'normale',
    note: payload.note || '', completedAt: null, assignedUserId: payload.assignedUserId || null, assignedUser: user,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  d.actions.push(action as any);
  return action;
}

export function demoUpdateAction(actionId: string, data: Record<string, any>) {
  for (const d of store()) {
    const a = d.actions.find(x => x.id === actionId);
    if (a) {
      Object.assign(a, data);
      if (data.status === 'done') a.completedAt = new Date().toISOString();
      if (data.status === 'todo') a.completedAt = null;
      if ('dueDate' in data && data.dueDate) a.dueDate = new Date(data.dueDate).toISOString();
      return a;
    }
  }
  return { id: actionId };
}

export function demoDeleteAction(actionId: string) {
  for (const d of store()) {
    const i = d.actions.findIndex(x => x.id === actionId);
    if (i >= 0) { d.actions.splice(i, 1); return; }
  }
}

export function demoAddEmail(dealId: string, payload: any) {
  const d = getDemoDeal(dealId);
  const tpl = demoTemplates.find(t => t.id === payload.templateId);
  const email = { id: `email-${Date.now()}`, dealId, to: payload.to, subject: payload.subject, body: payload.body, status: 'sent', sentAt: new Date().toISOString(), template: tpl ? { name: tpl.name } : undefined };
  d._emails.unshift(email as any);
  return email;
}
