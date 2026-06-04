// src/lib/import/importService.ts
/**
 * Service d'import CSV — Logique métier complète
 *
 * Règles appliquées :
 *   1. Nouveau magasin                          → nouvelle affaire dans "À appeler"
 *   2. Magasin existant + NOUVELLE offre        → retour automatique en "À appeler" (movedToCallAt + previousColumnId)
 *   3. Magasin existant + offre déjà connue     → lastSeenAt mis à jour, colonne INCHANGÉE
 *   4. Magasin existant + aucune offre nouvelle → colonne INCHANGÉE
 *   5. Offre active disparue du dernier import  → status = "disappeared", colonne INCHANGÉE
 */

import { prisma } from '@/lib/prisma';
import { generateBrandColor, normalizeText } from '@/lib/utils';
import { parseCsv, mapCsvRow, type MappedRow } from './csvParser';
import { buildDeduplicationKey, normalizeStoreName } from './deduplication';
import { buildOfferFingerprint } from './fingerprint';

export type ImportResult = {
  batchId:         string;
  fileName:        string;
  totalRows:       number;
  createdDeals:    number;
  updatedDeals:    number;
  newOffers:       number;
  movedToCall:     number;
  disappearedOffers: number;
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
  const errors: Array<{ row: number; message: string }> = [];
  const processedStoreIds = new Set<string>();

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
      let isNewDeal = false;

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
        isNewDeal = true;
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

      processedStoreIds.add(store.id);

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
            status: 'active',
          },
        });
        newOffers++;

        if (!isNewDeal) {
          // ─── RÈGLE CLÉ : Magasin existant + nouvelle offre → retour en "À appeler"
          await prisma.deal.update({
            where: { id: deal.id },
            data: {
              previousColumnId:        deal.columnId,      // mémoriser l'ancienne colonne
              columnId:                defaultColumn.id,   // → "À appeler"
              hasNewOfferFromLastImport: true,
              movedToCallAt:           new Date(),
            },
          });
          deal = { ...deal, columnId: defaultColumn.id }; // mettre à jour l'objet local
          movedToCall++;
        }
      } else {
        // ─── CAS 3 : Offre déjà connue → seulement lastSeenAt ──────────────
        // Aucun changement de colonne
        await prisma.jobOffer.update({
          where: { id: existingOffer.id },
          data: { lastSeenAt: new Date(), status: 'active' },
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

  // ── 6. CAS 5 : Marquer les offres disparues ───────────────────────────────
  // Une offre est "disparue" si son magasin n'était PAS dans cet import
  // et que l'offre était encore active avant
  const disappearedResult = await prisma.jobOffer.updateMany({
    where: {
      status:       'active',
      importBatchId: { not: batch.id },
      storeId:      { in: Array.from(processedStoreIds) },
    },
    data: { status: 'disappeared' },
  });
  const disappearedOffers = disappearedResult.count;

  // ── 7. Mettre à jour le résumé du batch ──────────────────────────────────
  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      createdDeals,
      updatedDeals,
      newOffers,
      movedToCall,
      disappearedOffers,
      errorCount: errors.length,
    },
  });

  return {
    batchId: batch.id, fileName,
    totalRows: rows.length,
    createdDeals, updatedDeals, newOffers, movedToCall,
    disappearedOffers, errorCount: errors.length, errors,
  };
}
