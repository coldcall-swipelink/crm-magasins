// src/lib/mock/data.ts
// Jeu de données fictif pour le mode preview / démo (aucune connexion DB).
// Tout est en mémoire : un magasin, un pipeline, des colonnes et des affaires
// (deals) réalistes pour pouvoir présenter le CRM sans base Neon.

type Row = Record<string, any>;

const now = new Date();
const day = 86_400_000;
const d = (offsetDays: number) => new Date(now.getTime() + offsetDays * day);

// ─── Enseignes ────────────────────────────────────────────────────────────────
const brands: Row[] = [
  { id: 'brand_carrefour',    name: 'Carrefour',    color: '#1d4ed8' },
  { id: 'brand_intermarche',  name: 'Intermarché',  color: '#e11d48' },
  { id: 'brand_leclerc',      name: 'E.Leclerc',    color: '#2563eb' },
  { id: 'brand_superu',       name: 'Super U',      color: '#f59e0b' },
  { id: 'brand_lidl',         name: 'Lidl',         color: '#ca8a04' },
  { id: 'brand_auchan',       name: 'Auchan',       color: '#7c3aed' },
].map(b => ({ ...b, createdAt: d(-40), updatedAt: d(-40) }));

// ─── Utilisateurs & collaborateurs ─────────────────────────────────────────────
const users: Row[] = [
  { id: 'user_bilal',  name: 'Bilal Yacouti', color: '#7c6bf0' },
  { id: 'user_sarah',  name: 'Sarah Lemoine',  color: '#ec4899' },
].map(u => ({ ...u, createdAt: d(-40), updatedAt: d(-40) }));

const collaborators: Row[] = [
  { id: 'collab_bilal', name: 'Bilal Yacouti', email: 'bilal@swipelink.fr', color: '#7c6bf0' },
  { id: 'collab_sarah', name: 'Sarah Lemoine',  email: 'sarah@swipelink.fr', color: '#ec4899' },
  { id: 'collab_tom',   name: 'Tom Bernard',    email: 'tom@swipelink.fr',   color: '#10b981' },
].map(c => ({ ...c, createdAt: d(-40), updatedAt: d(-40) }));

// ─── Pipeline & colonnes ───────────────────────────────────────────────────────
const pipelines: Row[] = [
  { id: 'pipe_main', name: 'Prospection magasins', position: 0, color: '#6d5ae6', createdAt: d(-40), updatedAt: d(-40) },
];

// Titres neutres volontairement (pas de « DEMO FAITE » / « Démo prévue » /
// « RELANCE 1 ») afin de ne déclencher aucun webhook n8n ni Google Meet en preview.
const columnDefs = [
  { id: 'col_acontacter', title: 'À contacter',   color: '#9a9cb5', position: 0 },
  { id: 'col_contactes',  title: 'Contactés',     color: '#4f6bff', position: 1 },
  { id: 'col_relance',    title: 'Relance',       color: '#f59e0b', position: 2 },
  { id: 'col_demo',       title: 'Démo planifiée', color: '#7c6bf0', position: 3 },
  { id: 'col_gagnes',     title: 'Gagnés',        color: '#16a34a', position: 4 },
  { id: 'col_perdus',     title: 'Perdus',        color: '#dc2626', position: 5 },
];
const pipelineColumns: Row[] = columnDefs.map(c => ({
  ...c, pipelineId: 'pipe_main', isDefault: c.position === 0, createdAt: d(-40), updatedAt: d(-40),
}));

// ─── Import batches (historique) ───────────────────────────────────────────────
const importBatches: Row[] = [
  { id: 'batch_1', fileName: 'offres_semaine_21.csv', importedAt: d(-21), totalRows: 142, createdDeals: 38, updatedDeals: 12, newOffers: 51, movedToCall: 9,  disappearedOffers: 4,  errorCount: 1 },
  { id: 'batch_2', fileName: 'offres_semaine_22.csv', importedAt: d(-14), totalRows: 156, createdDeals: 22, updatedDeals: 31, newOffers: 44, movedToCall: 14, disappearedOffers: 7,  errorCount: 0 },
  { id: 'batch_3', fileName: 'offres_semaine_23.csv', importedAt: d(-7),  totalRows: 168, createdDeals: 19, updatedDeals: 28, newOffers: 39, movedToCall: 11, disappearedOffers: 9,  errorCount: 2 },
  { id: 'batch_4', fileName: 'offres_semaine_24.csv', importedAt: d(-1),  totalRows: 174, createdDeals: 16, updatedDeals: 33, newOffers: 41, movedToCall: 13, disappearedOffers: 6,  errorCount: 0 },
].map(b => ({ ...b, createdAt: b.importedAt }));

// ─── Magasins + affaires (deals) ───────────────────────────────────────────────
type DealSeed = {
  id: string; brandId: string; store: string; city: string; cp: string; dep: string;
  col: string; pos: number; priority?: string; directeur?: string; civ?: string;
  nom?: string; tel?: string; email?: string; collab?: string; assigned?: string;
  value?: number; isNew?: boolean; hasNewOffer?: boolean; demoIn?: number;
  offers?: { title: string; contract: string; salary?: string }[];
  actions?: { title: string; type: string; in: number; time?: string; priority?: string; user?: string; note?: string }[];
  notes?: { content: string; author: string; daysAgo: number }[];
};

const dealSeeds: DealSeed[] = [
  { id: '1', brandId: 'brand_carrefour', store: 'Carrefour Market Lyon Part-Dieu', city: 'Lyon', cp: '69003', dep: '69',
    col: 'col_acontacter', pos: 0, priority: 'haute', directeur: 'M. Dubois', civ: 'Monsieur', nom: 'Dubois',
    tel: '04 72 33 12 00', email: 'direction.partdieu@carrefour.fr', collab: 'collab_bilal', isNew: true,
    offers: [{ title: 'Boucher (H/F)', contract: 'CDI', salary: '2 100 €' }, { title: 'Employé libre service', contract: 'CDD', salary: '1 800 €' }],
    actions: [{ title: 'Premier appel direction', type: 'Appeler', in: 0, time: '10:30', priority: 'haute', user: 'user_bilal' }] },

  { id: '2', brandId: 'brand_intermarche', store: 'Intermarché Toulouse Rangueil', city: 'Toulouse', cp: '31400', dep: '31',
    col: 'col_acontacter', pos: 1, priority: 'normale', directeur: 'Mme Garcia', civ: 'Madame', nom: 'Garcia',
    tel: '05 61 25 40 10', email: 'contact.rangueil@intermarche.fr', collab: 'collab_sarah', isNew: true,
    offers: [{ title: 'Responsable rayon frais', contract: 'CDI', salary: '2 400 €' }] },

  { id: '3', brandId: 'brand_leclerc', store: 'E.Leclerc Bordeaux Lac', city: 'Bordeaux', cp: '33300', dep: '33',
    col: 'col_acontacter', pos: 2, priority: 'normale', directeur: 'M. Martin', civ: 'Monsieur', nom: 'Martin',
    tel: '05 56 43 21 00', email: 'rh.lac@leclerc.fr', collab: 'collab_tom', hasNewOffer: true,
    offers: [{ title: 'Hôte de caisse', contract: 'CDD', salary: '1 766 €' }, { title: 'Poissonnier', contract: 'CDI', salary: '2 200 €' }] },

  { id: '4', brandId: 'brand_superu', store: 'Super U Nantes Beaulieu', city: 'Nantes', cp: '44200', dep: '44',
    col: 'col_contactes', pos: 0, priority: 'haute', directeur: 'M. Lefèvre', civ: 'Monsieur', nom: 'Lefèvre',
    tel: '02 40 12 88 00', email: 'direction@superu-beaulieu.fr', collab: 'collab_bilal', assigned: 'user_bilal',
    offers: [{ title: 'Boulanger (H/F)', contract: 'CDI', salary: '2 050 €' }],
    actions: [{ title: 'Relancer suite au 1er contact', type: 'Appeler', in: 1, time: '14:00', user: 'user_bilal' }],
    notes: [{ content: 'Directeur intéressé, demande une démo la semaine prochaine.', author: 'user_bilal', daysAgo: 1 }] },

  { id: '5', brandId: 'brand_lidl', store: 'Lidl Lille Wazemmes', city: 'Lille', cp: '59000', dep: '59',
    col: 'col_contactes', pos: 1, priority: 'normale', directeur: 'Mme Petit', civ: 'Madame', nom: 'Petit',
    tel: '03 20 55 10 00', email: 'rh.wazemmes@lidl.fr', collab: 'collab_sarah', assigned: 'user_sarah',
    offers: [{ title: 'Équipier polyvalent', contract: 'CDI', salary: '1 950 €' }],
    actions: [{ title: 'Envoyer plaquette de présentation', type: 'Email', in: -1, user: 'user_sarah', priority: 'haute' }] },

  { id: '6', brandId: 'brand_auchan', store: 'Auchan Strasbourg Illkirch', city: 'Illkirch', cp: '67400', dep: '67',
    col: 'col_relance', pos: 0, priority: 'haute', directeur: 'M. Schmitt', civ: 'Monsieur', nom: 'Schmitt',
    tel: '03 88 40 60 00', email: 'direction.illkirch@auchan.fr', collab: 'collab_tom', assigned: 'user_bilal',
    offers: [{ title: 'Manager de rayon', contract: 'CDI', salary: '2 600 €' }],
    actions: [{ title: '2e relance téléphonique', type: 'Appeler', in: -2, time: '09:30', priority: 'haute', user: 'user_bilal', note: 'Pas de réponse au 1er essai' }],
    notes: [{ content: 'Première relance effectuée, à recontacter en fin de semaine.', author: 'user_bilal', daysAgo: 3 }] },

  { id: '7', brandId: 'brand_carrefour', store: 'Carrefour Marseille Le Merlan', city: 'Marseille', cp: '13014', dep: '13',
    col: 'col_relance', pos: 1, priority: 'normale', directeur: 'Mme Roux', civ: 'Madame', nom: 'Roux',
    tel: '04 91 02 30 00', email: 'rh.merlan@carrefour.fr', collab: 'collab_sarah', assigned: 'user_sarah',
    offers: [{ title: 'Employé drive', contract: 'CDD', salary: '1 800 €' }] },

  { id: '8', brandId: 'brand_leclerc', store: 'E.Leclerc Rennes Cleunay', city: 'Rennes', cp: '35000', dep: '35',
    col: 'col_demo', pos: 0, priority: 'haute', directeur: 'M. Morel', civ: 'Monsieur', nom: 'Morel',
    tel: '02 99 35 12 00', email: 'direction.cleunay@leclerc.fr', collab: 'collab_bilal', assigned: 'user_bilal', demoIn: 2,
    offers: [{ title: 'Adjoint chef de rayon', contract: 'CDI', salary: '2 350 €' }],
    actions: [{ title: 'Préparer la démo produit', type: 'Tâche', in: 2, time: '11:00', user: 'user_bilal' }],
    notes: [{ content: 'Démo planifiée. Prévoir cas d’usage recrutement boucherie.', author: 'user_bilal', daysAgo: 2 }] },

  { id: '9', brandId: 'brand_superu', store: 'Super U Montpellier Celleneuve', city: 'Montpellier', cp: '34080', dep: '34',
    col: 'col_demo', pos: 1, priority: 'normale', directeur: 'Mme Blanc', civ: 'Madame', nom: 'Blanc',
    tel: '04 67 75 20 00', email: 'rh@superu-celleneuve.fr', collab: 'collab_tom', assigned: 'user_sarah', demoIn: 4,
    offers: [{ title: 'Vendeur fruits & légumes', contract: 'CDI', salary: '1 900 €' }] },

  { id: '10', brandId: 'brand_intermarche', store: 'Intermarché Nice Saint-Roch', city: 'Nice', cp: '06300', dep: '06',
    col: 'col_gagnes', pos: 0, priority: 'normale', directeur: 'M. Girard', civ: 'Monsieur', nom: 'Girard',
    tel: '04 93 56 70 00', email: 'direction.saintroch@intermarche.fr', collab: 'collab_bilal', assigned: 'user_bilal', value: 4990,
    offers: [{ title: 'Chef boucher', contract: 'CDI', salary: '2 800 €' }],
    notes: [{ content: 'Contrat signé 🎉 Onboarding prévu lundi.', author: 'user_bilal', daysAgo: 5 }] },

  { id: '11', brandId: 'brand_carrefour', store: 'Carrefour City Paris 15e', city: 'Paris', cp: '75015', dep: '75',
    col: 'col_gagnes', pos: 1, priority: 'normale', directeur: 'Mme Faure', civ: 'Madame', nom: 'Faure',
    tel: '01 45 30 00 00', email: 'rh.paris15@carrefour.fr', collab: 'collab_sarah', assigned: 'user_sarah', value: 3490,
    offers: [{ title: 'Employé de magasin', contract: 'CDI', salary: '1 950 €' }] },

  { id: '12', brandId: 'brand_lidl', store: 'Lidl Grenoble Europole', city: 'Grenoble', cp: '38000', dep: '38',
    col: 'col_perdus', pos: 0, priority: 'basse', directeur: 'M. Henry', civ: 'Monsieur', nom: 'Henry',
    tel: '04 76 00 12 00', email: 'rh.europole@lidl.fr', collab: 'collab_tom',
    offers: [{ title: 'Caissier (H/F)', contract: 'CDD', salary: '1 766 €' }],
    notes: [{ content: 'Budget recrutement gelé pour le trimestre. À recontacter Q3.', author: 'user_sarah', daysAgo: 6 }] },
];

const stores: Row[] = [];
const deals: Row[] = [];
const jobOffers: Row[] = [];
const actions: Row[] = [];
const notes: Row[] = [];

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

for (const s of dealSeeds) {
  const storeId = `store_${s.id}`;
  const dealId  = `deal_${s.id}`;
  stores.push({
    id: storeId, brandId: s.brandId, name: s.store, normalizedName: normalize(s.store),
    city: s.city, postalCode: s.cp, department: s.dep, address: `${10 + Number(s.id)} rue du Commerce`,
    phone: s.tel || '', email: s.email || '', siret: '', externalId: '',
    deduplicationKey: `seed:${storeId}`, createdAt: d(-30), updatedAt: d(-5),
  });

  deals.push({
    id: dealId, pipelineId: 'pipe_main', storeId, columnId: s.col, previousColumnId: null,
    priority: s.priority || 'normale', position: s.pos,
    isNewFromLastImport: !!s.isNew, hasNewOfferFromLastImport: !!s.hasNewOffer, isPresentInLastImport: true,
    movedToCallAt: s.col === 'col_contactes' ? d(-2) : null, lastImportAt: d(-1),
    directeur: s.directeur || '', contactCalling: s.tel || '', dealEmail: s.email || '',
    contactCivilite: s.civ || 'Monsieur', contactLastName: s.nom || '',
    dealValue: s.value ?? null, demoDate: s.demoIn != null ? d(s.demoIn) : null, candidateCallDate: null,
    googleEventId: null, googleMeetUrl: null,
    collaboratorId: s.collab || null, assignedUserId: s.assigned || null,
    createdAt: d(-20), updatedAt: d(-1),
  });

  (s.offers || []).forEach((o, i) => {
    jobOffers.push({
      id: `offer_${s.id}_${i}`, dealId, storeId, importBatchId: 'batch_4',
      externalOfferId: `EXT-${s.id}-${i}`, title: o.title, jobTitle: o.title,
      contractType: o.contract, salary: o.salary || '', source: 'HelloWork',
      url: 'https://www.hellowork.com/', publishedAt: d(-3).toISOString().slice(0, 10),
      fingerprint: `fp_${s.id}_${i}`, firstSeenAt: d(-3), lastSeenAt: d(-1),
      status: 'active', createdAt: d(-3), updatedAt: d(-1),
    });
  });

  (s.actions || []).forEach((a, i) => {
    actions.push({
      id: `action_${s.id}_${i}`, dealId, title: a.title, type: a.type,
      dueDate: d(a.in), dueTime: a.time || '', status: 'todo',
      priority: a.priority || 'normale', note: a.note || '', completedAt: null,
      assignedUserId: a.user || null, createdAt: d(-2), updatedAt: d(-2),
    });
  });

  (s.notes || []).forEach((n, i) => {
    const author = users.find(u => u.id === n.author);
    notes.push({
      id: `note_${s.id}_${i}`, dealId, content: n.content,
      authorId: n.author, authorName: author?.name || '',
      createdAt: d(-n.daysAgo), updatedAt: d(-n.daysAgo),
    });
  });
}

const emailTemplates: Row[] = [
  { id: 'tpl_intro', name: 'Introduction Swipelink', subject: 'Recrutez plus vite vos profils terrain — Swipelink',
    body: 'Bonjour {{contact}},\n\nSwipelink vous aide à chasser les profils pénuriques (boucher, boulanger, manager de rayon…) sans publier d’annonce.\n\nSeriez-vous disponible pour une courte démo ?\n\nBien à vous,\nL’équipe Swipelink', createdAt: d(-30), updatedAt: d(-30) },
  { id: 'tpl_relance', name: 'Relance après appel', subject: 'Suite à notre échange',
    body: 'Bonjour {{contact}},\n\nFaisant suite à notre conversation, voici les informations promises.\n\nÀ très vite,\nSwipelink', createdAt: d(-30), updatedAt: d(-30) },
];

const emailLogs: Row[] = [];
const importRows: Row[] = [];

export function buildSeed(): Record<string, Row[]> {
  // Clones profonds pour repartir d'un état neuf à chaque démarrage du process.
  const clone = (arr: Row[]) => arr.map(r => ({ ...r }));
  return {
    brand: clone(brands),
    store: clone(stores),
    collaborator: clone(collaborators),
    user: clone(users),
    pipeline: clone(pipelines),
    pipelineColumn: clone(pipelineColumns),
    deal: clone(deals),
    jobOffer: clone(jobOffers),
    importBatch: clone(importBatches),
    importRow: clone(importRows),
    action: clone(actions),
    note: clone(notes),
    emailTemplate: clone(emailTemplates),
    emailLog: clone(emailLogs),
  };
}
