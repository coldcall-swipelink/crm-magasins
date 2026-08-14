// src/types/index.ts

export type Priority = 'faible' | 'normale' | 'élevée' | 'urgente';
export type ActionType = 'Appeler' | 'Email' | 'Relancer' | 'Démo' | 'Autre';
export type ActionStatus = 'todo' | 'done';

export interface User {
  id:        string;
  name:      string;
  color:     string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Brand {
  id:        string;
  name:      string;
  color:     string;
  createdAt: string;
  updatedAt: string;
  _count?: { stores: number };
}

export interface Store {
  id:               string;
  brandId:          string | null;
  brand:            Brand | null;
  name:             string;
  normalizedName:   string;
  city:             string;
  postalCode:       string;
  department:       string;
  address:          string;
  phone:            string;
  email:            string;
  siret:            string;
  externalId:       string;
  deduplicationKey: string;
  latitude:         number | null;
  longitude:        number | null;
  geocodedAt:       string | null;
  geocodeQuery:     string;
  createdAt:        string;
  updatedAt:        string;
}

export interface JobOffer {
  id:              string;
  dealId:          string;
  storeId:         string;
  importBatchId:   string;
  externalOfferId: string;
  title:           string;
  jobTitle:        string;
  contractType:    string;
  salary:          string;
  source:          string;
  url:             string;
  publishedAt:     string;
  fingerprint:     string;
  firstSeenAt:     string;
  lastSeenAt:      string;
  createdAt:       string;
  updatedAt:       string;
}

export interface PipelineColumn {
  id:        string;
  title:     string;
  position:  number;
  color:     string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { deals: number };
}

export interface Action {
  id:          string;
  dealId:      string;
  deal?:       { store?: { name: string } };
  title:       string;
  type:        ActionType;
  dueDate:     string;
  dueTime:     string;
  status:      ActionStatus;
  priority:    Priority;
  note:        string;
  completedAt: string | null;
  assignedUserId?: string | null;
  assignedUser?:   User | null;
  createdAt:   string;
  updatedAt:   string;
}

export interface Note {
  id:         string;
  dealId:     string;
  content:    string;
  authorId?:  string | null;
  authorName?: string;
  author?:    User | null;
  createdAt:  string;
  updatedAt:  string;
}

export interface Subscription {
  id:                  string;
  dealId:              string;
  position:            number;
  value:               number | null;
  subscriptionType:    string;
  paymentMode:         'stripe' | 'virement';
  paymentTiming:       'comptant' | 'mensuel';
  closingDate:         string | null;
  subscriptionMonths:  number;
  subscriptionEndDate: string | null;
}

// Un changement d'étape journalisé (table DealMove). Colonnes ET pipelines de
// départ / arrivée, avec leurs noms figés au moment du déplacement.
export interface DealMove {
  id:               string;
  dealId:           string;
  fromColumnId:     string | null;
  fromColumnTitle:  string;
  fromPipelineId:   string | null;
  fromPipelineName: string;
  toColumnId:       string | null;
  toColumnTitle:    string;
  toPipelineId:     string | null;
  toPipelineName:   string;
  userId:           string | null;
  userName:         string;
  source:           'pipeline' | 'fiche' | 'import';
  movedAt:          string;
}

// Une démo bookée (table DemoBooking) : une ligne par passage de l'affaire dans
// « DEMO PREVUE » (pipeline Closing). Un rebooking ajoute une ligne.
export interface DemoBooking {
  id:       string;
  dealId:   string;
  userId:   string | null;
  userName: string;
  bookedAt: string;
  demoDate: string | null;
  noShow:   boolean;
}

export interface Deal {
  id:                       string;
  storeId:                  string;
  store:                    Store;
  columnId:                 string;
  column:                   PipelineColumn;
  previousColumnId:         string | null;
  parentDealId?:            string | null;
  childDeals?:              { id: string; dealValue?: number | null }[];
  priority:                 Priority;
  isPV?:                    boolean;
  paymentMode?:             'virement' | 'stripe';
  position:                 number;
  isNewFromLastImport:      boolean;
  hasNewOfferFromLastImport: boolean;
  isPresentInLastImport:    boolean;
  movedToCallAt:            string | null;
  lastImportAt:             string | null;
  directeur?:               string;
  contactCalling?:          string;
  dealEmail?:               string;
  // Numéro du contact : masqué dans la fiche affaire tant que l'utilisateur n'a
  // pas cliqué sur « Afficher le numéro » (clic comptabilisé comme un appel).
  contactPhone?:            string;
  contactCivilite?:         string;
  contactLastName?:         string;
  dealValue?:               number | null;
  demoDate?:                string | null;
  // Date du dernier booking de démo (miroir de la ligne DemoBooking la plus
  // récente). L'historique complet est dans demoBookings.
  demoBookedAt?:            string | null;
  candidateCallDate?:       string | null;
  closingDate?:             string | null;
  subscriptionType?:        string;
  paymentTiming?:           'comptant' | 'mensuel';
  subscriptionMonths?:      number;
  subscriptionEndDate?:     string | null;
  subscriptions?:           Subscription[];
  assignedUserId?:          string | null;
  assignedUser?:            User | null;
  createdAt:                string;
  updatedAt:                string;
  jobOffers:                JobOffer[];
  actions:                  Action[];
  notes:                    Note[];
  moves?:                   DealMove[];
  demoBookings?:            DemoBooking[];
  _count?: {
    jobOffers: number;
    actions:   number;
    childDeals?: number;
  };
}

export interface ImportBatch {
  id:                string;
  fileName:          string;
  importedAt:        string;
  totalRows:         number;
  createdDeals:      number;
  updatedDeals:      number;
  newOffers:         number;
  movedToCall:       number;
  errorCount:        number;
  createdAt:         string;
  importRows?: ImportRow[];
}

export interface ImportRow {
  id:           string;
  rowNumber:    number;
  rawData:      Record<string, unknown>;
  status:       'ok' | 'error' | 'skipped';
  errorMessage: string;
  storeId:      string | null;
  dealId:       string | null;
  store?:       { name: string } | null;
}

export interface DashboardStats {
  totalDeals:          number;
  totalStores:         number;
  newDealsLastImport:  number;
  updatedLastImport:   number;
  movedToCallLastImport: number;
  activeOffers:        number;
  actionsDueToday:     number;
  actionsOverdue:      number;
  dealsWithNoAction:   number;
  topBrands:           Array<{ name: string; color: string; count: number }>;
  lastImportDate:      string | null;
  lastImportFileName:  string | null;
  importHistory:       Array<{ date: string; created: number; newOffers: number; movedToCall: number }>;
}
