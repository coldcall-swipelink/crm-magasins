// src/lib/import/importService.ts
import { prisma } from '@/lib/prisma';
import { generateBrandColor, normalizeText } from '@/lib/utils';
import { parseCsv, mapCsvRow, type MappedRow } from './csvParser';
import { buildDeduplicationKey, normalizeStoreName } from './deduplication';
import { buildOfferFingerprint } from './fingerprint';

export type ImportResult = {
  batchId: string; fileName: string; totalRows: number;
  createdDeals: number; updatedDeals: number; newOffers: number;
  movedToCall: number; disappearedOffers: number;
  errorCount: number; errors: Array<{ row: number; message: string }>;
};

export async function runCsvImport(csvText: string, fileName: string): Promise<ImportResult> {
  const rows = parseCsv(csvText);
  if (rows.length === 0) throw new Error('Le fichier CSV est vide ou non lisible.');

  const defaultColumn = await prisma.pipelineColumn.findFirst({ where: { position: 0 } });
  if (!defaultColumn) throw new Error('Aucune colonne pipeline trouvée.');

  const batch = await prisma.importBatch.create({ data: { fileName, totalRows: rows.length } });

  await prisma.deal.updateMany({
    data: { isNewFromLastImport: false, hasNewOfferFromLastImport: false, isPresentInLastImport: false },
  });

  let createdDeals = 0, updatedDeals = 0, newOffers = 0, movedToCall = 0;
  const errors: Array<{ row: number; message: string }> = [];
  const processedStoreIds = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    try {
      const mapped: MappedRow = mapCsvRow(rows[i]);
      if (!mapped.brand && !mapped.storeName && !mapped.city) {
        throw new Error('Ligne sans données identifiables');
      }

      // Enseigne
      let brand = null;
      if (mapped.brand?.trim()) {
        brand = await prisma.brand.findFirst({ where: { name: { equals: mapped.brand.trim(), mode: 'insensitive' } } });
        if (!brand) brand = await prisma.brand.create({ data: { name: mapped.brand.trim(), color: generateBrandColor(mapped.brand) } });
      }

      // Magasin
      const dedupKey = buildDeduplicationKey(mapped);
      let store = await prisma.store.findUnique({ where: { deduplicationKey: dedupKey } });
      let deal;
      let isNewDeal = false;

      if (!store) {
        // CAS 1 : Nouveau magasin
        store = await prisma.store.create({
          data: {
            brandId: brand?.id ?? null,
            name: mapped.storeName || mapped.brand || 'Inconnu',
            normalizedName: normalizeStoreName(mapped),
            city: mapped.city || '',
            postalCode: mapped.postalCode || '',
            department: mapped.department || '',
            address: mapped.address || '',
            siret: mapped.siret || '',
            externalId: mapped.externalId || '',
            deduplicationKey: dedupKey,
          },
        });

        const positionInCol = await prisma.deal.count({ where: { columnId: defaultColumn.id } });

        deal = await prisma.deal.create({
          data: {
            storeId: store.id,
            columnId: defaultColumn.id,
            priority: 'normale',
            position: positionInCol,
            isNewFromLastImport: true,
            hasNewOfferFromLastImport: true,
            isPresentInLastImport: true,
            lastImportAt: new Date(),
            directeur: mapped.directeur || '',
            contactCalling: mapped.contactCalling || '',
            dealEmail: mapped.dealEmail || '',
          },
        });
        createdDeals++;
        isNewDeal = true;
      } else {
        // Magasin existant
        await prisma.store.update({
          where: { id: store.id },
          data: {
            updatedAt: new Date(),
            brandId: store.brandId ?? brand?.id ?? null,
            city: store.city || mapped.city || '',
            department: store.department || mapped.department || '',
            address: store.address || mapped.address || '',
          },
        });

        deal = await prisma.deal.findUnique({ where: { storeId: store.id } });
        if (!deal) {
          deal = await prisma.deal.create({
            data: {
              storeId: store.id, columnId: defaultColumn.id,
              priority: 'normale', position: 0,
              isNewFromLastImport: false, hasNewOfferFromLastImport: false,
              isPresentInLastImport: true, lastImportAt: new Date(),
            },
          });
        }

        await prisma.deal.update({
          where: { id: deal.id },
          data: {
            isPresentInLastImport: true,
            lastImportAt: new Date(),
            ...(mapped.directeur      && { directeur:      mapped.directeur }),
            ...(mapped.contactCalling && { contactCalling: mapped.contactCalling }),
            ...(mapped.dealEmail      && { dealEmail:       mapped.dealEmail }),
          },
        });
        updatedDeals++;
      }

      processedStoreIds.add(store.id);

      // Offre
      const fingerprint = buildOfferFingerprint(store.id, mapped);
      const existingOffer = await prisma.jobOffer.findUnique({ where: { fingerprint } });

      if (!existingOffer) {
        // CAS 2 : Nouvelle offre
        await prisma.jobOffer.create({
          data: {
            dealId: deal.id, storeId: store.id, importBatchId: batch.id,
            externalOfferId: mapped.externalOfferId || '',
            title: mapped.offerTitle || mapped.jobTitle || '',
            jobTitle: mapped.jobTitle || '',
            contractType: mapped.contractType || '',
            salary: mapped.salary || '',
            source: mapped.source || '',
            url: mapped.url || '',
            publishedAt: mapped.publishedAt || '',
            fingerprint, status: 'active',
          },
        });
        newOffers++;

        if (!isNewDeal) {
          // RÈGLE CLÉ : retour en "À appeler"
          await prisma.deal.update({
            where: { id: deal.id },
            data: {
              previousColumnId: deal.columnId,
              columnId: defaultColumn.id,
              hasNewOfferFromLastImport: true,
              movedToCallAt: new Date(),
            },
          });
          deal = { ...deal, columnId: defaultColumn.id };
          movedToCall++;
        }
      } else {
        // CAS 3 : Offre connue
        await prisma.jobOffer.update({
          where: { id: existingOffer.id },
          data: { lastSeenAt: new Date(), status: 'active' },
        });
      }

      await prisma.importRow.create({
        data: {
          importBatchId: batch.id, rowNumber: rowNum,
          rawData: rows[i] as object, status: 'ok',
          storeId: store.id, dealId: deal.id,
        },
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ row: rowNum, message: msg });
      await prisma.importRow.create({
        data: {
          importBatchId: batch.id, rowNumber: rowNum,
          rawData: rows[i] as object, status: 'error', errorMessage: msg,
        },
      });
    }
  }

  // Offres disparues
  const disappearedResult = await prisma.jobOffer.updateMany({
    where: { status: 'active', importBatchId: { not: batch.id }, storeId: { notIn: Array.from(processedStoreIds) } },
    data: { status: 'disappeared' },
  });

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { createdDeals, updatedDeals, newOffers, movedToCall, disappearedOffers: disappearedResult.count, errorCount: errors.length },
  });

  return {
    batchId: batch.id, fileName, totalRows: rows.length,
    createdDeals, updatedDeals, newOffers, movedToCall,
    disappearedOffers: disappearedResult.count, errorCount: errors.length, errors,
  };
}
