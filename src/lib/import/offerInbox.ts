// src/lib/import/offerInbox.ts
/**
 * Boîte de réception des offres poussées par une automatisation (N8N).
 *
 * Chaîne complète :
 *   1. N8N appelle POST /api/webhooks/job-offers?token=… avec ses lignes
 *      (JSON ou CSV) → `receiveOffers` les range dans un lot (OfferInbox) sans
 *      rien créer dans le pipeline ;
 *   2. le CRM affiche la popup « Nouvelles offres reçues » et l'utilisateur
 *      coche celles à importer ;
 *   3. `decideInboxOffers` fait passer les offres cochées par l'import normal
 *      (runMappedImport → mêmes règles que le CSV) et écarte les autres.
 *
 * Rien n'entre donc dans le pipeline sans arbitrage humain, exactement comme
 * avec le tri manuel de l'Excel qu'on recevait par email.
 */

import { prisma } from '@/lib/prisma';
import { simpleHash, normalizeText } from '@/lib/utils';
import { mapCsvRow, parseCsv, type CsvRow, type MappedRow } from './csvParser';
import { buildDeduplicationKey } from './deduplication';
import { buildOfferFingerprint } from './fingerprint';
import { findStoreForRow, runMappedImport, type ImportResult } from './importService';

/** Charge utile acceptée par le webhook : des lignes (objets libres) ou du CSV. */
export type InboundPayload = {
  rows?: unknown;
  csv?: string;
  label?: string;
  source?: string;
};

export type ReceiveResult = {
  inboxId:    string;
  label:      string;
  totalRows:  number;
  newRows:    number;
  duplicates: number;
  knownStores: number;
  knownOffers: number;
  ignored:    number;
};

/**
 * Clé de déduplication d'une offre À LA RÉCEPTION.
 *
 * Même esprit que `buildOfferFingerprint` (id externe > URL > hash métier),
 * mais indexée sur la clé de dédup MAGASIN et non sur un `storeId` : à la
 * réception, le magasin peut très bien ne pas encore exister en base. Une offre
 * déjà reçue — importée, écartée ou encore en attente — n'est ainsi jamais
 * reproposée deux fois.
 */
export function buildInboxOfferKey(mapped: MappedRow): string {
  if (mapped.externalOfferId?.trim()) return `ext:${mapped.externalOfferId.trim()}`;
  if (mapped.url?.trim()) return `url:${normalizeText(mapped.url.trim())}`;

  const key = [
    buildDeduplicationKey(mapped),
    normalizeText(mapped.offerTitle || ''),
    normalizeText(mapped.jobTitle || ''),
    mapped.publishedAt || '',
    normalizeText(mapped.source || ''),
    normalizeText(mapped.salary || ''),
    normalizeText(mapped.contractType || ''),
  ].join('|');

  return `hash:${simpleHash(key)}`;
}

/** Aplatit une valeur reçue en JSON vers la chaîne attendue par le mapping CSV.
 *  N8N envoie volontiers des nombres, des booléens ou des null : tout est ramené
 *  au texte, les objets/tableaux étant sérialisés pour rester lisibles. */
function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/** Normalise une ligne JSON en ligne « CSV » exploitable par `mapCsvRow`
 *  (mêmes alias de colonnes que le fichier importé à la main : « enseigne »,
 *  « nom magasin », « ville », « poste », « lien »…). */
function toCsvRow(row: Record<string, unknown>): CsvRow {
  const out: CsvRow = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.trim().toLowerCase()] = toText(value);
  }
  return out;
}

/** Extrait les lignes d'une charge utile, quelle que soit sa forme :
 *  tableau nu, { rows }, { offers }, { data }, { items }, { results }, ou un
 *  objet unique (une seule offre). */
function extractRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
  }
  if (!payload || typeof payload !== 'object') return [];

  const obj = payload as Record<string, unknown>;
  for (const key of ['rows', 'offers', 'offres', 'data', 'items', 'results']) {
    if (Array.isArray(obj[key])) return extractRows(obj[key]);
  }

  // Objet unique = une offre. On écarte les clés d'enveloppe pour ne pas
  // confondre « { label, source } » avec une offre.
  const keys = Object.keys(obj).filter(k => !['label', 'source', 'csv'].includes(k));
  return keys.length > 0 ? [obj] : [];
}

/** Libellé par défaut d'un lot : « Offres N8N — 12/03/2026 14:05 ». */
function defaultLabel(source: string): string {
  const stamp = new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date());
  return `${source || 'Offres reçues'} — ${stamp}`;
}

/**
 * Range un envoi de l'automatisation dans un nouveau lot.
 *
 * Rien n'est créé dans le pipeline : on se contente de qualifier chaque offre
 * (magasin déjà suivi ? offre déjà importée ?) pour que le tri dans le CRM soit
 * immédiat. Les offres déjà reçues par le passé sont ignorées silencieusement
 * (comptées dans `duplicates`), ce qui rend le webhook rejouable sans risque.
 */
export async function receiveOffers(payload: InboundPayload): Promise<ReceiveResult> {
  const label = (payload.label || '').trim();
  const source = (payload.source || '').trim();

  // Deux formats acceptés : lignes JSON, ou texte CSV (même parseur que
  // l'import manuel — l'automatisation peut donc pousser son fichier tel quel).
  const rawRows: Record<string, unknown>[] = payload.csv?.trim()
    ? (parseCsv(payload.csv) as unknown as Record<string, unknown>[])
    : extractRows(payload.rows);

  if (rawRows.length === 0) {
    throw new Error("Aucune offre exploitable dans la charge utile (attendu : un tableau d'offres ou un CSV).");
  }

  const inbox = await prisma.offerInbox.create({
    data: { label: label || defaultLabel(source), source, totalRows: rawRows.length },
  });

  let newRows = 0;
  let duplicates = 0;
  let ignored = 0;
  let knownStores = 0;
  let knownOffers = 0;

  // Clés déjà vues DANS CET ENVOI : un même lot peut contenir deux fois la
  // même offre, et la contrainte d'unicité ne le dirait qu'à l'insertion.
  const seen = new Set<string>();

  for (const raw of rawRows) {
    const mapped = mapCsvRow(toCsvRow(raw));

    // Même garde-fou que l'import CSV : une ligne sans rien d'identifiable ne
    // sert à rien dans la liste de tri.
    if (!mapped.brand && !mapped.storeName && !mapped.city) {
      ignored++;
      continue;
    }

    const receptionKey = buildInboxOfferKey(mapped);
    if (seen.has(receptionKey)) {
      duplicates++;
      continue;
    }
    seen.add(receptionKey);

    // Déjà reçue lors d'un envoi précédent (importée, écartée ou en attente) :
    // on ne la repropose pas.
    const already = await prisma.inboxOffer.findUnique({
      where: { receptionKey },
      select: { id: true },
    });
    if (already) {
      duplicates++;
      continue;
    }

    // Qualification : le magasin est-il déjà suivi, l'offre déjà importée ?
    const store = await findStoreForRow(mapped);
    const deal = store
      ? await prisma.deal.findUnique({ where: { storeId: store.id }, select: { id: true } })
      : null;
    const knownOffer = store
      ? !!(await prisma.jobOffer.findUnique({
          where: { fingerprint: buildOfferFingerprint(store.id, mapped) },
          select: { id: true },
        }))
      : false;

    if (store) knownStores++;
    if (knownOffer) knownOffers++;

    try {
      await prisma.inboxOffer.create({
        data: {
          inboxId:         inbox.id,
          rawData:         raw as object,
          brand:           mapped.brand,
          storeName:       mapped.storeName,
          city:            mapped.city,
          postalCode:      mapped.postalCode,
          department:      mapped.department,
          address:         mapped.address,
          jobTitle:        mapped.jobTitle,
          offerTitle:      mapped.offerTitle,
          contractType:    mapped.contractType,
          salary:          mapped.salary,
          source:          mapped.source || source,
          url:             mapped.url,
          publishedAt:     mapped.publishedAt,
          externalOfferId: mapped.externalOfferId,
          receptionKey,
          storeKey:        buildDeduplicationKey(mapped),
          knownStore:      !!store,
          knownOffer,
          existingDealId:  deal?.id ?? null,
        },
      });
      newRows++;
    } catch (err) {
      // Deux envois simultanés portant la même offre : le test d'existence
      // ci-dessus a pu passer dans les deux, et c'est la contrainte d'unicité
      // sur receptionKey qui tranche. Le perdant compte simplement un doublon
      // de plus — sans quoi tout l'envoi échouerait pour une offre déjà rangée
      // par l'autre.
      if ((err as { code?: string })?.code !== 'P2002') throw err;
      duplicates++;
    }
  }

  // Lot entièrement composé de doublons/lignes vides : rien à trier, on le
  // classe tout de suite pour ne pas ouvrir une popup vide.
  await prisma.offerInbox.update({
    where: { id: inbox.id },
    data: {
      newRows,
      duplicateRows: duplicates,
      ...(newRows === 0 && { status: 'processed', processedAt: new Date(), processedBy: 'Réception' }),
    },
  });

  return {
    inboxId: inbox.id,
    label: inbox.label,
    totalRows: rawRows.length,
    newRows,
    duplicates,
    knownStores,
    knownOffers,
    ignored,
  };
}

export type DecideResult = {
  imported:  number;
  rejected:  number;
  /** Résumé de l'import déclenché (null si aucune offre n'a été cochée). */
  import:    ImportResult | null;
  /** Lots entièrement tranchés par cette décision. */
  closedInboxIds: string[];
};

/**
 * Applique le tri fait dans le CRM : les offres cochées passent par l'import
 * normal, les autres sont écartées.
 *
 * `rejectIds` est explicite (et non « tout le reste du lot ») pour qu'un tri
 * partiel reste possible : ce qui n'est cité ni dans l'une ni dans l'autre
 * liste reste en attente.
 */
export async function decideInboxOffers(
  importIds: string[],
  rejectIds: string[],
  decidedBy: string,
): Promise<DecideResult> {
  const wanted = Array.from(new Set(importIds.filter(Boolean)));
  const unwanted = Array.from(new Set(rejectIds.filter(Boolean))).filter(id => !wanted.includes(id));

  // Seules les offres encore en attente sont arbitrables : une offre déjà
  // importée ne doit pas l'être une seconde fois si deux onglets tranchent le
  // même lot.
  const toImport = await prisma.inboxOffer.findMany({
    where: { id: { in: wanted }, status: 'pending' },
    orderBy: { createdAt: 'asc' },
  });

  let result: ImportResult | null = null;
  if (toImport.length > 0) {
    const inboxes = await prisma.offerInbox.findMany({
      where: { id: { in: Array.from(new Set(toImport.map(o => o.inboxId))) } },
      select: { id: true, label: true },
    });
    const fileName = inboxes.length === 1
      ? inboxes[0].label
      : `Offres reçues — ${toImport.length} offre(s)`;

    result = await runMappedImport(
      toImport.map(offer => ({
        // La charge utile d'origine est re-mappée : les colonnes de l'InboxOffer
        // sont un extrait d'affichage, `rawData` reste la source de vérité (elle
        // peut porter des champs supplémentaires : contact, note, SIRET…).
        mapped: mapCsvRow(toCsvRow(offer.rawData as Record<string, unknown>)),
        raw: offer.rawData as Record<string, unknown>,
      })),
      fileName,
      // Un lot trié est un envoi PARTIEL : ne pas marquer « absentes du dernier
      // import » toutes les affaires qui n'y figurent pas (cf. l'option).
      { resetLastImportFlags: false },
    );

    await prisma.inboxOffer.updateMany({
      where: { id: { in: toImport.map(o => o.id) } },
      data: { status: 'imported', decidedAt: new Date(), decidedBy },
    });
    await prisma.offerInbox.updateMany({
      where: { id: { in: inboxes.map(i => i.id) } },
      data: { importBatchId: result.batchId },
    });
  }

  const rejected = unwanted.length > 0
    ? (await prisma.inboxOffer.updateMany({
        where: { id: { in: unwanted }, status: 'pending' },
        data: { status: 'rejected', decidedAt: new Date(), decidedBy },
      })).count
    : 0;

  // Un lot dont plus aucune offre n'attend est classé.
  const touchedInboxIds = Array.from(new Set([
    ...toImport.map(o => o.inboxId),
    ...(unwanted.length
      ? (await prisma.inboxOffer.findMany({ where: { id: { in: unwanted } }, select: { inboxId: true } }))
          .map(o => o.inboxId)
      : []),
  ]));

  const closedInboxIds: string[] = [];
  for (const inboxId of touchedInboxIds) {
    const remaining = await prisma.inboxOffer.count({ where: { inboxId, status: 'pending' } });
    if (remaining === 0) {
      await prisma.offerInbox.update({
        where: { id: inboxId },
        data: { status: 'processed', processedAt: new Date(), processedBy: decidedBy },
      });
      closedInboxIds.push(inboxId);
    }
  }

  return { imported: toImport.length, rejected, import: result, closedInboxIds };
}
