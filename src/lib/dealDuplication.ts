// src/lib/dealDuplication.ts
//
// Duplication « à l'identique » d'une affaire vers une autre colonne, dans le
// cadre du workflow « Prospection de Valeur ».
//
// Extrait de /api/deals/[id]/duplicate pour être appelé depuis deux endroits :
//   • la pop-up PV du pipeline (quelqu'un déplace une carte à la main) ;
//   • la réservation du parcours boucher (le directeur du magasin réserve
//     lui-même sa démo — personne n'est devant le CRM à ce moment-là).
//
// La copie recrée un magasin (Store.deduplicationKey étant unique, il ne peut
// pas être partagé) puis l'affaire, et recopie offres, notes et actions.

import { prisma } from '@/lib/prisma';
import { normalizeText } from '@/lib/utils';

export interface DuplicationTarget {
  pipeline: string;
  column: string;
}

/** Cibles du workflow « Prospection de Valeur ». */
export const PV_TARGETS = {
  oui: { pipeline: 'Recrutement', column: 'SOURCING A FAIRE' },
  non: { pipeline: 'Closing', column: 'DEMO PREVUE' },
} as const satisfies Record<string, DuplicationTarget>;

export type DuplicationResult =
  | { ok: true; dealId: string; target: DuplicationTarget }
  | { ok: false; reason: 'deal_not_found' | 'column_not_found'; message: string };

/**
 * Duplique une affaire vers (pipeline, colonne), désignés par leurs noms.
 *
 * Tout se fait dans une seule transaction : une copie à moitié faite (magasin
 * sans affaire, affaire sans offres) serait pire que pas de copie du tout.
 */
export async function duplicateDeal(
  dealId: string,
  target: DuplicationTarget,
): Promise<DuplicationResult> {
  const source = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { store: true, jobOffers: true, notes: true, actions: true },
  });
  if (!source) {
    return { ok: false, reason: 'deal_not_found', message: 'Affaire source introuvable' };
  }

  const targetCol = await prisma.pipelineColumn.findFirst({
    where: { title: target.column, pipeline: { name: target.pipeline } },
  });
  if (!targetCol) {
    return {
      ok: false,
      reason: 'column_not_found',
      message: `Colonne « ${target.column} » du pipeline « ${target.pipeline} » introuvable`,
    };
  }

  const created = await prisma.$transaction(async tx => {
    const s = source.store;

    // 1. Copie du magasin (deduplicationKey unique).
    const newStore = await tx.store.create({
      data: {
        brandId: s.brandId,
        name: s.name,
        normalizedName: s.normalizedName,
        city: s.city,
        postalCode: s.postalCode,
        department: s.department,
        address: s.address,
        phone: s.phone,
        email: s.email,
        siret: s.siret,
        externalId: s.externalId,
        // Même adresse → on recopie le géocodage pour que le deal dupliqué soit
        // localisé d'emblée sur la carte (sinon il faut le re-géocoder).
        latitude: s.latitude,
        longitude: s.longitude,
        geocodeQuery: s.geocodeQuery,
        geocodedAt: s.geocodedAt,
        deduplicationKey: `dup:${normalizeText(s.name)}:${normalizeText(s.city)}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      },
    });

    const position = await tx.deal.count({ where: { columnId: targetCol.id } });

    // 2. Nouvelle affaire (copie des champs métier).
    const newDeal = await tx.deal.create({
      data: {
        pipelineId: targetCol.pipelineId,
        storeId: newStore.id,
        columnId: targetCol.id,
        priority: source.priority,
        position,
        directeur: source.directeur,
        contactCalling: source.contactCalling,
        contactPosition: source.contactPosition,
        dealEmail: source.dealEmail,
        contactCivilite: source.contactCivilite,
        contactLastName: source.contactLastName,
        contactPhone: source.contactPhone,
        dealValue: source.dealValue,
        demoDate: source.demoDate,
        candidateCallDate: source.candidateCallDate,
        collaboratorId: source.collaboratorId,
        assignedUserId: source.assignedUserId,
        // Réponses du parcours boucher : c'est l'affaire de sourcing qui en a le
        // plus besoin — c'est elle qui sert à chasser les deux profils.
        isPV: source.isPV,
        pvExperience: source.pvExperience,
        pvSalaire: source.pvSalaire,
        pvPriseDePoste: source.pvPriseDePoste,
        isNewFromLastImport: false,
        hasNewOfferFromLastImport: false,
        isPresentInLastImport: true,
      },
    });

    // 3. Offres d'emploi (fingerprint unique → préfixe avec le nouvel id).
    for (const o of source.jobOffers) {
      await tx.jobOffer.create({
        data: {
          dealId: newDeal.id,
          storeId: newStore.id,
          importBatchId: o.importBatchId,
          externalOfferId: o.externalOfferId,
          title: o.title,
          jobTitle: o.jobTitle,
          contractType: o.contractType,
          salary: o.salary,
          source: o.source,
          url: o.url,
          publishedAt: o.publishedAt,
          fingerprint: `dup:${newDeal.id}:${o.fingerprint}`,
        },
      });
    }

    // 4. Notes.
    for (const n of source.notes) {
      await tx.note.create({
        data: {
          dealId: newDeal.id,
          content: n.content,
          authorId: n.authorId,
          authorName: n.authorName,
        },
      });
    }

    // 5. Actions / rappels.
    for (const a of source.actions) {
      await tx.action.create({
        data: {
          dealId: newDeal.id,
          title: a.title,
          type: a.type,
          dueDate: a.dueDate,
          dueTime: a.dueTime,
          status: a.status,
          priority: a.priority,
          note: a.note,
          completedAt: a.completedAt,
          assignedUserId: a.assignedUserId,
        },
      });
    }

    return newDeal;
  });

  return { ok: true, dealId: created.id, target };
}
