// src/lib/mock/engine.ts
// Mini-moteur en mémoire reproduisant le sous-ensemble de l'API Prisma utilisé
// par les routes du CRM (findMany/findFirst/findUnique/count/aggregate/create/
// update/updateMany/delete/deleteMany, avec where/include/select/_count/orderBy).
// Permet de faire tourner l'app en preview/démo sans aucune base de données.

import { buildSeed } from './data';

type Row = Record<string, any>;
type Rel = { kind: 'one' | 'revOne' | 'many'; model: string; fk: string };

// Carte des relations : pour chaque modèle, comment résoudre chaque relation.
//  - one    : record[fk] === target.id            (clé étrangère portée par le record)
//  - revOne : target[fk] === record.id            (relation inverse 1-1)
//  - many   : target[fk] === record.id            (relation 1-N)
const relations: Record<string, Record<string, Rel>> = {
  brand: { stores: { kind: 'many', model: 'store', fk: 'brandId' } },
  store: {
    brand: { kind: 'one', model: 'brand', fk: 'brandId' },
    deal: { kind: 'revOne', model: 'deal', fk: 'storeId' },
    jobOffers: { kind: 'many', model: 'jobOffer', fk: 'storeId' },
    importRows: { kind: 'many', model: 'importRow', fk: 'storeId' },
  },
  collaborator: { deals: { kind: 'many', model: 'deal', fk: 'collaboratorId' } },
  user: {
    assignedDeals: { kind: 'many', model: 'deal', fk: 'assignedUserId' },
    assignedActions: { kind: 'many', model: 'action', fk: 'assignedUserId' },
    authoredNotes: { kind: 'many', model: 'note', fk: 'authorId' },
  },
  pipeline: {
    columns: { kind: 'many', model: 'pipelineColumn', fk: 'pipelineId' },
    deals: { kind: 'many', model: 'deal', fk: 'pipelineId' },
  },
  pipelineColumn: {
    pipeline: { kind: 'one', model: 'pipeline', fk: 'pipelineId' },
    deals: { kind: 'many', model: 'deal', fk: 'columnId' },
  },
  deal: {
    store: { kind: 'one', model: 'store', fk: 'storeId' },
    column: { kind: 'one', model: 'pipelineColumn', fk: 'columnId' },
    pipeline: { kind: 'one', model: 'pipeline', fk: 'pipelineId' },
    collaborator: { kind: 'one', model: 'collaborator', fk: 'collaboratorId' },
    assignedUser: { kind: 'one', model: 'user', fk: 'assignedUserId' },
    jobOffers: { kind: 'many', model: 'jobOffer', fk: 'dealId' },
    actions: { kind: 'many', model: 'action', fk: 'dealId' },
    notes: { kind: 'many', model: 'note', fk: 'dealId' },
    importRows: { kind: 'many', model: 'importRow', fk: 'dealId' },
    emailLogs: { kind: 'many', model: 'emailLog', fk: 'dealId' },
  },
  jobOffer: {
    deal: { kind: 'one', model: 'deal', fk: 'dealId' },
    store: { kind: 'one', model: 'store', fk: 'storeId' },
    importBatch: { kind: 'one', model: 'importBatch', fk: 'importBatchId' },
  },
  importBatch: {
    importRows: { kind: 'many', model: 'importRow', fk: 'importBatchId' },
    jobOffers: { kind: 'many', model: 'jobOffer', fk: 'importBatchId' },
  },
  importRow: {
    importBatch: { kind: 'one', model: 'importBatch', fk: 'importBatchId' },
    store: { kind: 'one', model: 'store', fk: 'storeId' },
    deal: { kind: 'one', model: 'deal', fk: 'dealId' },
  },
  action: {
    deal: { kind: 'one', model: 'deal', fk: 'dealId' },
    assignedUser: { kind: 'one', model: 'user', fk: 'assignedUserId' },
  },
  note: {
    deal: { kind: 'one', model: 'deal', fk: 'dealId' },
    author: { kind: 'one', model: 'user', fk: 'authorId' },
  },
  emailTemplate: { emailLogs: { kind: 'many', model: 'emailLog', fk: 'templateId' } },
  emailLog: {
    deal: { kind: 'one', model: 'deal', fk: 'dealId' },
    template: { kind: 'one', model: 'emailTemplate', fk: 'templateId' },
  },
};

// Valeurs par défaut pour les créations (champs non fournis par les routes mais
// potentiellement lus par l'UI). Complète, n'écrase jamais les données fournies.
const defaults: Record<string, Row> = {
  brand: { color: '#7c6bf0' },
  store: { brandId: null, city: '', postalCode: '', department: '', address: '', phone: '', email: '', siret: '', externalId: '', normalizedName: '' },
  collaborator: { email: '', color: '#7c6bf0' },
  user: { color: '#7c6bf0' },
  pipeline: { position: 0, color: '#6d5ae6' },
  pipelineColumn: { color: '#7c6bf0', position: 0, isDefault: false },
  deal: {
    previousColumnId: null, priority: 'normale', position: 0,
    isNewFromLastImport: false, hasNewOfferFromLastImport: false, isPresentInLastImport: true,
    movedToCallAt: null, lastImportAt: null, directeur: '', contactCalling: '', dealEmail: '',
    contactCivilite: 'Monsieur', contactLastName: '', dealValue: null, demoDate: null,
    candidateCallDate: null, googleEventId: null, googleMeetUrl: null,
    collaboratorId: null, assignedUserId: null,
  },
  jobOffer: { externalOfferId: '', title: '', jobTitle: '', contractType: '', salary: '', source: '', url: '', publishedAt: '', status: 'active' },
  importBatch: { totalRows: 0, createdDeals: 0, updatedDeals: 0, newOffers: 0, movedToCall: 0, disappearedOffers: 0, errorCount: 0 },
  importRow: { status: 'ok', errorMessage: '', storeId: null, dealId: null },
  action: { type: 'Appeler', dueTime: '', status: 'todo', priority: 'normale', note: '', completedAt: null, assignedUserId: null },
  note: { authorId: null, authorName: '' },
  emailTemplate: { subject: '', body: '' },
  emailLog: { status: 'sent', resendId: null, openedAt: null, templateId: null },
};

let idCounter = 0;
const genId = (model: string) => `${model}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

const toTime = (v: any): number => {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return isNaN(t) ? 0 : t;
};

function cmp(a: any, b: any): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (a instanceof Date || b instanceof Date) return toTime(a) - toTime(b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  return String(a).localeCompare(String(b));
}

const asArray = (v: any) => (Array.isArray(v) ? v : [v]);

export function createMockEngine() {
  const db: Record<string, Row[]> = buildSeed();
  const arr = (model: string) => (db[model] ||= []);

  // ── Résolution d'une relation pour un enregistrement ─────────────────────────
  function resolveRelation(rec: Row, model: string, relName: string): any {
    const rel = relations[model]?.[relName];
    if (!rel) return undefined;
    const target = arr(rel.model);
    if (rel.kind === 'one') return target.find(t => t.id === rec[rel.fk]) ?? null;
    if (rel.kind === 'revOne') return target.find(t => t[rel.fk] === rec.id) ?? null;
    return target.filter(t => t[rel.fk] === rec.id);
  }

  // ── Évaluation d'une condition scalaire ──────────────────────────────────────
  function matchValue(fieldVal: any, cond: any): boolean {
    if (cond === null) return fieldVal === null || fieldVal === undefined;
    if (cond instanceof Date) return toTime(fieldVal) === cond.getTime();
    if (typeof cond !== 'object') return fieldVal === cond;

    const insensitive = cond.mode === 'insensitive';
    const norm = (x: any) => (insensitive && typeof x === 'string' ? x.toLowerCase() : x);

    for (const op of Object.keys(cond)) {
      const v = cond[op];
      switch (op) {
        case 'mode': break;
        case 'equals': if (norm(fieldVal) !== norm(v)) return false; break;
        case 'not':
          if (v === null) { if (fieldVal === null || fieldVal === undefined) return false; }
          else if (norm(fieldVal) === norm(v)) return false;
          break;
        case 'contains': {
          const hay = norm((fieldVal ?? '').toString());
          if (!hay.includes(norm(v.toString()))) return false;
          break;
        }
        case 'startsWith': if (!(fieldVal ?? '').toString().startsWith(v)) return false; break;
        case 'endsWith': if (!(fieldVal ?? '').toString().endsWith(v)) return false; break;
        case 'in': if (!asArray(v).includes(fieldVal)) return false; break;
        case 'notIn': if (asArray(v).includes(fieldVal)) return false; break;
        case 'gt': if (!(toTime(fieldVal) > toTime(v))) return false; break;
        case 'gte': if (!(toTime(fieldVal) >= toTime(v))) return false; break;
        case 'lt': if (!(toTime(fieldVal) < toTime(v))) return false; break;
        case 'lte': if (!(toTime(fieldVal) <= toTime(v))) return false; break;
        default: break;
      }
    }
    return true;
  }

  // ── Évaluation d'un where complet (scalaires + relations + AND/OR/NOT) ────────
  function matchWhere(rec: Row, where: any, model: string): boolean {
    if (!where) return true;
    for (const key of Object.keys(where)) {
      const cond = where[key];
      if (key === 'AND') { if (!asArray(cond).every(w => matchWhere(rec, w, model))) return false; continue; }
      if (key === 'OR') { if (!asArray(cond).some(w => matchWhere(rec, w, model))) return false; continue; }
      if (key === 'NOT') { if (asArray(cond).some(w => matchWhere(rec, w, model))) return false; continue; }

      const rel = relations[model]?.[key];
      if (rel) {
        if (rel.kind === 'many') {
          const list: Row[] = resolveRelation(rec, model, key);
          if ('none' in cond) { if (list.some(r => matchWhere(r, cond.none, rel.model))) return false; }
          else if ('some' in cond) { if (!list.some(r => matchWhere(r, cond.some, rel.model))) return false; }
          else if ('every' in cond) { if (!list.every(r => matchWhere(r, cond.every, rel.model))) return false; }
          else if (!list.some(r => matchWhere(r, cond, rel.model))) return false;
        } else {
          const related = resolveRelation(rec, model, key);
          if (!related || !matchWhere(related, cond, rel.model)) return false;
        }
        continue;
      }
      if (!matchValue(rec[key], cond)) return false;
    }
    return true;
  }

  function applyOrderBy(list: Row[], orderBy: any): Row[] {
    if (!orderBy) return list;
    const orders = asArray(orderBy);
    return [...list].sort((a, b) => {
      for (const o of orders) {
        const field = Object.keys(o)[0];
        const dir = o[field] === 'desc' ? -1 : 1;
        const c = cmp(a[field], b[field]);
        if (c !== 0) return c * dir;
      }
      return 0;
    });
  }

  function buildCount(rec: Row, model: string, selectObj: any): Row {
    const out: Row = {};
    for (const key of Object.keys(selectObj || {})) {
      if (!selectObj[key]) continue;
      const list = resolveRelation(rec, model, key);
      out[key] = Array.isArray(list) ? list.length : 0;
    }
    return out;
  }

  // ── Projection d'un enregistrement selon include / select ────────────────────
  function project(rec: Row, model: string, opts: any = {}): Row {
    if (opts?.select) {
      const out: Row = {};
      for (const key of Object.keys(opts.select)) {
        const sel = opts.select[key];
        if (!sel) continue;
        if (key === '_count') { out._count = buildCount(rec, model, sel.select); continue; }
        if (relations[model]?.[key]) out[key] = projectRelation(rec, model, key, typeof sel === 'object' ? sel : {});
        else out[key] = rec[key];
      }
      return out;
    }

    const out: Row = { ...rec };
    if (opts?.include) {
      for (const key of Object.keys(opts.include)) {
        const inc = opts.include[key];
        if (!inc) continue;
        if (key === '_count') { out._count = buildCount(rec, model, inc.select); continue; }
        out[key] = projectRelation(rec, model, key, typeof inc === 'object' ? inc : {});
      }
    }
    return out;
  }

  function projectRelation(rec: Row, model: string, relName: string, subOpts: any): any {
    const rel = relations[model][relName];
    const resolved = resolveRelation(rec, model, relName);
    if (rel.kind === 'many') {
      let list: Row[] = resolved;
      if (subOpts.where) list = list.filter(r => matchWhere(r, subOpts.where, rel.model));
      if (subOpts.orderBy) list = applyOrderBy(list, subOpts.orderBy);
      if (subOpts.skip) list = list.slice(subOpts.skip);
      if (subOpts.take != null) list = list.slice(0, subOpts.take);
      return list.map(r => project(r, rel.model, subOpts));
    }
    return resolved ? project(resolved, rel.model, subOpts) : null;
  }

  // ── Mutations ────────────────────────────────────────────────────────────────
  function newRecord(model: string, data: Row): Row {
    const base = defaults[model] || {};
    const rec: Row = { ...base, ...data };
    if (!rec.id) rec.id = genId(model);
    const ts = new Date();
    if (rec.createdAt === undefined) rec.createdAt = ts;
    if (rec.updatedAt === undefined) rec.updatedAt = ts;
    return rec;
  }

  function applyData(rec: Row, data: Row) {
    for (const key of Object.keys(data)) {
      const v = data[key];
      if (v && typeof v === 'object' && !(v instanceof Date) && 'set' in v) rec[key] = v.set;
      else if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) rec[key] = (rec[key] ?? 0) + v.increment;
      else if (v && typeof v === 'object' && !(v instanceof Date) && 'decrement' in v) rec[key] = (rec[key] ?? 0) - v.decrement;
      else rec[key] = v;
    }
  }

  // Suppressions en cascade alignées sur le schéma Prisma (onDelete).
  function cascadeDelete(model: string, rec: Row) {
    const removeWhere = (m: string, pred: (r: Row) => boolean) => {
      const removed = arr(m).filter(pred);
      db[m] = arr(m).filter(r => !pred(r));
      removed.forEach(r => cascadeDelete(m, r));
    };
    const nullify = (m: string, fk: string, id: string) => arr(m).forEach(r => { if (r[fk] === id) r[fk] = null; });

    switch (model) {
      case 'deal':
        removeWhere('action', r => r.dealId === rec.id);
        removeWhere('note', r => r.dealId === rec.id);
        removeWhere('emailLog', r => r.dealId === rec.id);
        removeWhere('jobOffer', r => r.dealId === rec.id);
        nullify('importRow', 'dealId', rec.id);
        break;
      case 'pipelineColumn':
        removeWhere('deal', r => r.columnId === rec.id);
        break;
      case 'pipeline':
        removeWhere('pipelineColumn', r => r.pipelineId === rec.id);
        removeWhere('deal', r => r.pipelineId === rec.id);
        break;
      case 'brand':
        nullify('store', 'brandId', rec.id);
        break;
      case 'collaborator':
        nullify('deal', 'collaboratorId', rec.id);
        break;
      case 'user':
        nullify('deal', 'assignedUserId', rec.id);
        nullify('action', 'assignedUserId', rec.id);
        nullify('note', 'authorId', rec.id);
        break;
      case 'emailTemplate':
        nullify('emailLog', 'templateId', rec.id);
        break;
      default: break;
    }
  }

  // ── Delegate exposé par modèle (mime l'API Prisma) ───────────────────────────
  function delegate(model: string) {
    const filtered = (where: any) => arr(model).filter(r => matchWhere(r, where, model));
    return {
      findMany: async (args: any = {}) => {
        let list = filtered(args.where);
        if (args.orderBy) list = applyOrderBy(list, args.orderBy);
        if (args.skip) list = list.slice(args.skip);
        if (args.take != null) list = list.slice(0, args.take);
        return list.map(r => project(r, model, args));
      },
      findFirst: async (args: any = {}) => {
        let list = filtered(args.where);
        if (args.orderBy) list = applyOrderBy(list, args.orderBy);
        return list.length ? project(list[0], model, args) : null;
      },
      findUnique: async (args: any = {}) => {
        const r = arr(model).find(x => matchWhere(x, args.where, model));
        return r ? project(r, model, args) : null;
      },
      findUniqueOrThrow: async (args: any = {}) => {
        const r = arr(model).find(x => matchWhere(x, args.where, model));
        if (!r) throw new Error(`[mock] ${model} introuvable`);
        return project(r, model, args);
      },
      count: async (args: any = {}) => filtered(args.where).length,
      aggregate: async (args: any = {}) => {
        const list = filtered(args.where);
        const res: Row = {};
        for (const agg of ['_max', '_min'] as const) {
          if (!args[agg]) continue;
          res[agg] = {};
          for (const f of Object.keys(args[agg])) {
            if (!list.length) { res[agg][f] = null; continue; }
            const vals = list.map(r => r[f]).filter(v => v != null);
            res[agg][f] = vals.length ? (agg === '_max' ? vals.reduce((a, b) => (cmp(a, b) >= 0 ? a : b)) : vals.reduce((a, b) => (cmp(a, b) <= 0 ? a : b))) : null;
          }
        }
        if (args._count) res._count = list.length;
        return res;
      },
      create: async (args: any) => {
        const rec = newRecord(model, args.data || {});
        arr(model).push(rec);
        return project(rec, model, args);
      },
      createMany: async (args: any) => {
        const data = asArray(args.data || []);
        data.forEach((dd: Row) => arr(model).push(newRecord(model, dd)));
        return { count: data.length };
      },
      update: async (args: any) => {
        const r = arr(model).find(x => matchWhere(x, args.where, model));
        if (!r) throw new Error(`[mock] ${model} introuvable pour update`);
        applyData(r, args.data || {});
        r.updatedAt = new Date();
        return project(r, model, args);
      },
      updateMany: async (args: any) => {
        const list = filtered(args.where);
        list.forEach(r => { applyData(r, args.data || {}); r.updatedAt = new Date(); });
        return { count: list.length };
      },
      upsert: async (args: any) => {
        const r = arr(model).find(x => matchWhere(x, args.where, model));
        if (r) { applyData(r, args.update || {}); r.updatedAt = new Date(); return project(r, model, args); }
        const rec = newRecord(model, { ...args.where, ...args.create });
        arr(model).push(rec);
        return project(rec, model, args);
      },
      delete: async (args: any) => {
        const i = arr(model).findIndex(x => matchWhere(x, args.where, model));
        if (i < 0) throw new Error(`[mock] ${model} introuvable pour delete`);
        const [removed] = arr(model).splice(i, 1);
        cascadeDelete(model, removed);
        return project(removed, model, args);
      },
      deleteMany: async (args: any = {}) => {
        const toDelete = filtered(args.where);
        db[model] = arr(model).filter(r => !toDelete.includes(r));
        toDelete.forEach(r => cascadeDelete(model, r));
        return { count: toDelete.length };
      },
    };
  }

  // Un delegate par modèle, accessible via prisma.<model>.<méthode>().
  const client: Row = {};
  for (const model of Object.keys(relations)) client[model] = delegate(model);
  // Modèles sans relation déclarée mais référencés (sécurité).
  for (const model of Object.keys(db)) if (!client[model]) client[model] = delegate(model);

  // No-ops pour compat (transactions/connexion).
  client.$transaction = async (arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(client);
  client.$connect = async () => {};
  client.$disconnect = async () => {};
  client.$on = () => {};
  client.$use = () => {};

  return client;
}
