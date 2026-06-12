// src/lib/import/importService.ts
/**
 * Service d'import CSV — Logique métier complète
 *
 * Règles appliquées :
 *   1. Nouveau magasin                          → nouvelle affaire dans "À appeler"
 *   2. Magasin existant + NOUVELLE offre        → retour automatique en "À appeler" (movedToCallAt + previousColumnId)
 *   3. Magasin existant + offre déjà connue     → lastSeenAt mis à jour, colonne INCHANGÉE
 *   4. Magasin existant + aucune offre nouvelle → colonne INCHANGÉE
 */

import { prisma } from '@/lib/prisma';
import { generateBrandColor, normalizeText } from '@/lib/utils';
import { parseCsv, mapCsvRow, parseImportDate, type MappedRow } from './csvParser';
import { buildDeduplicationKey, normalizeStoreName } from './deduplication';
import { buildOfferFingerprint } from './fingerprint';

/**
 * Crée la note d'une ligne CSV sur une affaire, avec déduplication.
 * Format « long » : une ligne = une note. Un même magasin peut donc apparaître
 * sur plusieurs lignes, chacune ajoutant sa propre note (avec sa date/auteur).
 *
 * Déduplication (pour qu'un réimport du même fichier ne crée pas de doublons) :
 *   • si une date est fournie → clé = affaire + contenu + date
 *   • sinon                   → clé = affaire + contenu
 *
 * Renvoie true si une note a été créée, false si rien à faire ou doublon.
 */
async function createImportNote(dealId: string, mapped: MappedRow): Promise<boolean> {
  const content = mapped.note?.trim();
  if (!content) return false;

  const noteDate = parseImportDate(mapped.noteDate);
  const existing = await prisma.note.findFirst({
    where: noteDate
      ? { dealId, content, createdAt: noteDate }
      : { dealId, content },
  });
  if (existing) return false;

  await prisma.note.create({
    data: {
      dealId,
      content,
      authorName: mapped.noteAuthor?.trim() || 'Import',
      // Conserve la date d'origine (reprise ancien CRM) si fournie ;
      // sinon Prisma applique @default(now()).
      ...(noteDate && { createdAt: noteDate }),
    },
  });
  return true;
}

export type ImportResult = {
  batchId:         string;
  fileName:        string;
  totalRows:       number;
  createdDeals:    number;
  updatedDeals:    number;
  newOffers:       number;
  movedToCall:     number;
  createdNotes:    number;
  errorCount:      number;
  errors:          Array<{ row: number; message: string }>;
};

export async function runCsvImport(
  csvText: string,
  fileName: string
): Promise<ImportResult> {
  // ── 1. Parsing CSV ────────────────────────────────────────────────────────
  const rows = parseCsv(csvText);
  if (rows.length === 0) throw new Error('Le fichier CSV est vide ou non lisible.');

  // ── 2. Récupérer le pipeline Prospection et la colonne "À appeler" ────────
  const prospectionPipeline = await prisma.pipeline.findFirst({ 
    where: { name: 'Prospection' } 
  });
  if (!prospectionPipeline) throw new Error('Pipeline Prospection non trouvé');

  const defaultColumn = await prisma.pipelineColumn.findFirst({ 
    where: { 
      pipelineId: prospectionPipeline.id,
      title: 'À appeler'
    } 
  });
  if (!defaultColumn) throw new Error('Colonne "À appeler" non trouvée dans le pipeline Prospection');

  // ── 3. Créer le batch d'import ────────────────────────────────────────────
  const batch = await prisma.importBatch.create({
    data: { fileName, totalRows: rows.length },
  });

  // ── 4. Réinitialiser les flags des affaires existantes ────────────────────
  await prisma.deal.updateMany({
    data: {
      isNewFromLastImport:      false,
      hasNewOfferFromLastImport: false,
      isPresentInLastImport:    false,
    },
  });

  // ── 5. Traiter chaque ligne ───────────────────────────────────────────────
  let createdDeals    = 0;
  let updatedDeals    = 0;
  let newOffers       = 0;
  let movedToCall     = 0;
  let createdNotes    = 0;
  const errors: Array<{ row: number; message: string }> = [];
  const dealsToMove = new Set<string>(); // Track deals à basculer

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    try {
      const mapped: MappedRow = mapCsvRow(rows[i]);
      console.log(`[ROW ${rowNum}] directeur="${mapped.directeur}" contactCalling="${mapped.contactCalling}" dealEmail="${mapped.dealEmail}"`);

      // Validation minimale
      if (!mapped.brand && !mapped.storeName && !mapped.city) {
        throw new Error('Ligne sans données identifiables (enseigne, magasin ou ville manquants)');
      }

      // ── A. Trouver ou créer l'enseigne ──────────────────────────────────
      let brand = null;
      if (mapped.brand?.trim()) {
        brand = await prisma.brand.findFirst({
          where: { name: { equals: mapped.brand.trim(), mode: 'insensitive' } },
        });
        if (!brand) {
          brand = await prisma.brand.create({
            data: { name: mapped.brand.trim(), color: generateBrandColor(mapped.brand) },
          });
        }
      }

      // ── B. Déduplication magasin ─────────────────────────────────────────
      const dedupKey = buildDeduplicationKey(mapped);
      let store = await prisma.store.findUnique({ where: { deduplicationKey: dedupKey } });
      let deal;

      if (!store) {
        // ─── CAS 1 : Nouveau magasin ────────────────────────────────────────
        store = await prisma.store.create({
          data: {
            brandId:         brand?.id ?? null,
            name:            mapped.storeName || mapped.brand || 'Inconnu',
            normalizedName:  normalizeStoreName(mapped),
            city:            mapped.city        || '',
            postalCode:      mapped.postalCode  || '',
            department:      mapped.department  || '',
            address:         mapped.address     || '',
            siret:           mapped.siret       || '',
            externalId:      mapped.externalId  || '',
            deduplicationKey: dedupKey,
          },
        });

        // Compter les affaires déjà dans la colonne par défaut pour ordonner
        const positionInCol = await prisma.deal.count({ where: { columnId: defaultColumn.id } });

        deal = await prisma.deal.create({
          data: {
            pipelineId:              prospectionPipeline.id,
            storeId:                 store.id,
            columnId:                defaultColumn.id,
            priority:                'normale',
            position:                positionInCol,
            isNewFromLastImport:     true,
            hasNewOfferFromLastImport: true,
            isPresentInLastImport:   true,
            lastImportAt:            new Date(),
            directeur:               mapped.directeur     || '',
            contactCalling:          mapped.contactCalling || '',
            dealEmail:               mapped.dealEmail      || '',
          },
        });
        createdDeals++;
      } else {
        // Magasin connu → mettre à jour et récupérer l'affaire
        await prisma.store.update({
          where: { id: store.id },
          data: {
            updatedAt:  new Date(),
            brandId:    store.brandId ?? brand?.id ?? null,
            // Mise à jour des champs si manquants
            city:       store.city       || mapped.city       || '',
            department: store.department || mapped.department || '',
            address:    store.address    || mapped.address    || '',
          },
        });

        deal = await prisma.deal.findUnique({ where: { storeId: store.id } });
        if (!deal) {
          // Cas rare : affaire manquante → recréer
          deal = await prisma.deal.create({
            data: {
              pipelineId: prospectionPipeline.id,
              storeId: store.id,
              columnId: defaultColumn.id,
              priority: 'normale',
              position: 0,
              isNewFromLastImport: false,
              hasNewOfferFromLastImport: false,
              isPresentInLastImport: true,
              lastImportAt: new Date(),
            },
          });
        }

        await prisma.deal.update({
          where: { id: deal.id },
          data: {
            isPresentInLastImport: true,
            lastImportAt: new Date(),
            // Mettre à jour les contacts si fournis dans le CSV
            ...(mapped.directeur     && { directeur:     mapped.directeur }),
            ...(mapped.contactCalling && { contactCalling: mapped.contactCalling }),
            ...(mapped.dealEmail      && { dealEmail:      mapped.dealEmail }),
          },
        });
        updatedDeals++;
      }

      dealsToMove.add(deal.id); // Ajouter aux deals à basculer

      // ── B bis. Note de reprise (CSV) ─────────────────────────────────────
      // Format « long » : chaque ligne ajoute sa note à l'affaire (même si
      // l'affaire existe déjà / lignes suivantes d'un même magasin), avec
      // déduplication pour éviter les doublons au réimport.
      if (await createImportNote(deal.id, mapped)) createdNotes++;

      // ── C. Déduplication offre ───────────────────────────────────────────
      const fingerprint = buildOfferFingerprint(store.id, mapped);
      const existingOffer = await prisma.jobOffer.findUnique({ where: { fingerprint } });

      if (!existingOffer) {
        // ─── CAS 2 : Nouvelle offre jamais vue ─────────────────────────────
        await prisma.jobOffer.create({
          data: {
            dealId:         deal.id,
            storeId:        store.id,
            importBatchId:  batch.id,
            externalOfferId: mapped.externalOfferId || '',
            title:          mapped.offerTitle || mapped.jobTitle || '',
            jobTitle:       mapped.jobTitle   || '',
            contractType:   mapped.contractType || '',
            salary:         mapped.salary     || '',
            source:         mapped.source     || '',
            url:            mapped.url        || '',
            publishedAt:    mapped.publishedAt || '',
            fingerprint,
          },
        });
        newOffers++;
      } else {
        // ─── CAS 3 : Offre déjà connue → seulement lastSeenAt ──────────────
        // Aucun changement de colonne
        await prisma.jobOffer.update({
          where: { id: existingOffer.id },
          data: { lastSeenAt: new Date() },
        });
      }

      // ── D. Enregistrer la ligne d'import ─────────────────────────────────
      await prisma.importRow.create({
        data: {
          importBatchId: batch.id,
          rowNumber:     rowNum,
          rawData:       rows[i] as object,
          status:        'ok',
          storeId:       store.id,
          dealId:        deal.id,
        },
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ row: rowNum, message: msg });
      await prisma.importRow.create({
        data: {
          importBatchId: batch.id,
          rowNumber:     rowNum,
          rawData:       rows[i] as object,
          status:        'error',
          errorMessage:  msg,
        },
      });
    }
  }

  // ── 6. Basculer TOUS les deals traités en "À appeler" ─────────────────────
  for (const dealId of Array.from(dealsToMove)) {
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    if (deal && deal.columnId !== defaultColumn.id) {
      await prisma.deal.update({
        where: { id: dealId },
        data: {
          previousColumnId: deal.columnId,
          columnId: defaultColumn.id,
          movedToCallAt: new Date(),
        },
      });
      movedToCall++;
    }
  }

  // ── 7. Mettre à jour le résumé du batch ──────────────────────────────────
  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      createdDeals,
      updatedDeals,
      newOffers,
      movedToCall,
      errorCount: errors.length,
    },
  });

  return {
    batchId: batch.id, fileName,
    totalRows: rows.length,
    createdDeals, updatedDeals, newOffers, movedToCall, createdNotes,
    errorCount: errors.length, errors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Import CIBLÉ (sans offres) — place les NOUVEAUX magasins dans une colonne
// précise du pipeline. Variante volontairement isolée de l'import normal :
//   • pas de colonne JobOffer (CSV sans offres),
//   • pas de remise à zéro des flags « dernier import » (ne perturbe pas le
//     suivi de l'import d'offres),
//   • pas de règle « nouvelle offre → retour À appeler »,
//   • les magasins DÉJÀ présents sont ignorés (création des nouveaux seulement).
// ─────────────────────────────────────────────────────────────────────────────
export type TargetedImportResult = {
  batchId:         string;
  fileName:        string;
  totalRows:       number;
  createdDeals:    number;
  updatedBrands:   number;
  skippedExisting: number;
  movedDeals:      number;
  createdNotes:    number;
  errorCount:      number;
  errors:          Array<{ row: number; message: string }>;
  columnTitle:     string;
};

/** Comportement pour un deal déjà existant lors d'un import ciblé. */
export type OnExisting = 'skip' | 'move';

export async function runTargetedCsvImport(
  csvText: string,
  fileName: string,
  columnId: string,
  onExisting: OnExisting = 'skip',
): Promise<TargetedImportResult> {
  const rows = parseCsv(csvText);
  if (rows.length === 0) throw new Error('Le fichier CSV est vide ou non lisible.');

  const column = await prisma.pipelineColumn.findUnique({ where: { id: columnId } });
  if (!column) throw new Error('Colonne de destination introuvable.');

  const batch = await prisma.importBatch.create({ data: { fileName, totalRows: rows.length } });

  let createdDeals = 0;
  let updatedBrands = 0;
  let skippedExisting = 0;
  let movedDeals = 0;
  let createdNotes = 0;
  const errors: Array<{ row: number; message: string }> = [];

  // Position de départ : à la suite des affaires déjà dans la colonne cible.
  let position = await prisma.deal.count({ where: { columnId } });

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    try {
      const mapped: MappedRow = mapCsvRow(rows[i]);

      if (!mapped.brand && !mapped.storeName && !mapped.city) {
        throw new Error('Ligne sans données identifiables (enseigne, magasin ou ville manquants)');
      }

      // Enseigne (trouvée ou créée).
      let brand = null;
      if (mapped.brand?.trim()) {
        brand = await prisma.brand.findFirst({
          where: { name: { equals: mapped.brand.trim(), mode: 'insensitive' } },
        });
        if (!brand) {
          brand = await prisma.brand.create({
            data: { name: mapped.brand.trim(), color: generateBrandColor(mapped.brand) },
          });
        }
      }

      // Déduplication magasin.
      const dedupKey = buildDeduplicationKey(mapped);
      let existing = await prisma.store.findUnique({ where: { deduplicationKey: dedupKey } });

      // Repêchage du cas « enseigne oubliée » : un import précédent sans enseigne
      // a produit une clé différente (k:|ville|nom). On retrouve le magasin par
      // nom normalisé + ville, à condition qu'il n'ait PAS encore d'enseigne,
      // pour pouvoir corriger l'enseigne manquante sans créer de doublon.
      const normName = normalizeStoreName(mapped);
      if (!existing && brand && normName) {
        existing = await prisma.store.findFirst({
          where: {
            brandId: null,
            normalizedName: normName,
            city: { equals: mapped.city || '', mode: 'insensitive' },
          },
        });
      }

      let store;
      let deal;

      if (existing) {
        // Magasin déjà présent : on ne crée pas de nouvelle affaire. On peut
        // corriger l'enseigne si elle est fournie et différente (clé de dédup
        // réalignée au passage), et — format « long » oblige — y rattacher la
        // note de la ligne.
        const brandCorrected = !!(brand && existing.brandId !== brand.id);
        if (brandCorrected) {
          await prisma.store.update({
            where: { id: existing.id },
            data: { brandId: brand!.id, deduplicationKey: dedupKey },
          });
          updatedBrands++;
        }
        store = existing;
        deal = await prisma.deal.findUnique({ where: { storeId: store.id } });

        // Comportement choisi pour un deal existant :
        //   • 'move' → déplacer l'affaire vers le pipeline/étape ciblé ;
        //   • 'skip' → ne pas toucher à l'affaire (comportement par défaut).
        if (deal && onExisting === 'move' && deal.columnId !== column.id) {
          await prisma.deal.update({
            where: { id: deal.id },
            data: {
              previousColumnId: deal.columnId,
              pipelineId:       column.pipelineId,
              columnId:         column.id,
              position:         position++,
            },
          });
          movedDeals++;
        } else if (!brandCorrected) {
          skippedExisting++;
        }
      } else {
        store = await prisma.store.create({
          data: {
            brandId:         brand?.id ?? null,
            name:            mapped.storeName || mapped.brand || 'Inconnu',
            normalizedName:  normalizeStoreName(mapped),
            city:            mapped.city       || '',
            postalCode:      mapped.postalCode || '',
            department:      mapped.department || '',
            address:         mapped.address    || '',
            siret:           mapped.siret      || '',
            externalId:      mapped.externalId || '',
            deduplicationKey: dedupKey,
          },
        });

        deal = await prisma.deal.create({
          data: {
            pipelineId:                column.pipelineId,
            storeId:                   store.id,
            columnId:                  column.id,
            priority:                  'normale',
            position:                  position++,
            isNewFromLastImport:       false,
            hasNewOfferFromLastImport: false,
            isPresentInLastImport:     true,
            lastImportAt:              new Date(),
            directeur:                 mapped.directeur     || '',
            contactCalling:            mapped.contactCalling || '',
            dealEmail:                 mapped.dealEmail      || '',
          },
        });
        createdDeals++;
      }

      // Note de reprise (CSV) — une ligne = une note, dédupliquée.
      if (deal && await createImportNote(deal.id, mapped)) createdNotes++;

      await prisma.importRow.create({
        data: {
          importBatchId: batch.id,
          rowNumber:     rowNum,
          rawData:       rows[i] as object,
          status:        existing ? 'skipped' : 'ok',
          storeId:       store.id,
          dealId:        deal?.id ?? null,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ row: rowNum, message: msg });
      await prisma.importRow.create({
        data: {
          importBatchId: batch.id,
          rowNumber:     rowNum,
          rawData:       rows[i] as object,
          status:        'error',
          errorMessage:  msg,
        },
      });
    }
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { createdDeals, updatedDeals: updatedBrands, newOffers: 0, movedToCall: 0, errorCount: errors.length },
  });

  return {
    batchId: batch.id, fileName,
    totalRows: rows.length,
    createdDeals, updatedBrands, skippedExisting, movedDeals, createdNotes,
    errorCount: errors.length, errors,
    columnTitle: column.title,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Import de NOTES seules — rattache des notes à des affaires DÉJÀ existantes.
// Pensé pour l'étape 2 d'une reprise (les deals ont été importés au préalable).
//   • aucune création d'affaire ni de magasin,
//   • correspondance par clé de déduplication (enseigne + ville + magasin, ou
//     SIRET / id externe si fournis) — exactement comme à la création des deals,
//   • format « long » : une ligne = une note (auteur + date facultatifs),
//   • magasin/affaire introuvable → ligne ignorée (comptée), pas d'erreur.
// ─────────────────────────────────────────────────────────────────────────────
export type NotesImportResult = {
  notesMode:    true;
  batchId:      string;
  fileName:     string;
  totalRows:    number;
  createdNotes: number;
  matchedDeals: number;
  notFound:     number;
  errorCount:   number;
  errors:       Array<{ row: number; message: string }>;
};

export async function runNotesImport(
  csvText: string,
  fileName: string,
): Promise<NotesImportResult> {
  const rows = parseCsv(csvText);
  if (rows.length === 0) throw new Error('Le fichier CSV est vide ou non lisible.');

  const batch = await prisma.importBatch.create({ data: { fileName, totalRows: rows.length } });

  let createdNotes = 0;
  let notFound = 0;
  const matched = new Set<string>();
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    try {
      const mapped: MappedRow = mapCsvRow(rows[i]);

      if (!mapped.brand && !mapped.storeName) {
        throw new Error('Ligne sans magasin identifiable (enseigne ou nom magasin requis)');
      }
      if (!mapped.note?.trim()) {
        await prisma.importRow.create({
          data: { importBatchId: batch.id, rowNumber: rowNum, rawData: rows[i] as object, status: 'skipped', errorMessage: 'Ligne sans note' },
        });
        continue;
      }

      // Correspondance avec un magasin/affaire existant (aucune création).
      const dedupKey = buildDeduplicationKey(mapped);
      const store = await prisma.store.findUnique({ where: { deduplicationKey: dedupKey } });
      const deal = store ? await prisma.deal.findUnique({ where: { storeId: store.id } }) : null;

      if (!deal) {
        notFound++;
        await prisma.importRow.create({
          data: { importBatchId: batch.id, rowNumber: rowNum, rawData: rows[i] as object, status: 'skipped', storeId: store?.id ?? null, errorMessage: 'Affaire introuvable — note ignorée' },
        });
        continue;
      }

      if (await createImportNote(deal.id, mapped)) {
        createdNotes++;
        matched.add(deal.id);
      }
      await prisma.importRow.create({
        data: { importBatchId: batch.id, rowNumber: rowNum, rawData: rows[i] as object, status: 'ok', storeId: store!.id, dealId: deal.id },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ row: rowNum, message: msg });
      await prisma.importRow.create({
        data: { importBatchId: batch.id, rowNumber: rowNum, rawData: rows[i] as object, status: 'error', errorMessage: msg },
      });
    }
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { createdDeals: 0, updatedDeals: 0, newOffers: 0, movedToCall: 0, errorCount: errors.length },
  });

  return {
    notesMode: true,
    batchId: batch.id, fileName,
    totalRows: rows.length,
    createdNotes, matchedDeals: matched.size, notFound,
    errorCount: errors.length, errors,
  };
}
