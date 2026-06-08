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

export interface Deal {
  id:                       string;
  storeId:                  string;
  store:                    Store;
  columnId:                 string;
  column:                   PipelineColumn;
  previousColumnId:         string | null;
  priority:                 Priority;
  position:                 number;
  isNewFromLastImport:      boolean;
  hasNewOfferFromLastImport: boolean;
  isPresentInLastImport:    boolean;
  movedToCallAt:            string | null;
  lastImportAt:             string | null;
  directeur?:               string;
  contactCalling?:          string;
  dealEmail?:               string;
  contactCivilite?:         string;
  contactLastName?:         string;
  dealValue?:               number | null;
  demoDate?:                string | null;
  candidateCallDate?:       string | null;
  assignedUserId?:          string | null;
  assignedUser?:            User | null;
  createdAt:                string;
  updatedAt:                string;
  jobOffers:                JobOffer[];
  actions:                  Action[];
  notes:                    Note[];
  _count?: {
    jobOffers: number;
    actions:   number;
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
