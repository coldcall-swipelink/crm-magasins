// src/app/api/deals/[id]/duplicate/route.ts
//
// Duplication « à l'identique » d'une affaire vers une autre colonne/pipeline,
// dans le cadre du workflow « Prospection de Valeur » (déclenché quand une
// affaire arrive dans « Démo prévue » du pipeline « Prospection ») :
//   - choice = 'oui'  → Recrutement › SOURCING A FAIRE
//   - choice = 'non'  → Closing › DEMO PREVUE
//
// La copie recrée un nouveau magasin (Store.deduplicationKey étant unique, on
// ne peut pas partager le magasin) + une nouvelle affaire, et recopie les
// offres d'emploi, les notes et les actions.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeText } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Cibles de duplication selon le choix « Prospection de Valeur ».
const TARGETS = {
  oui: { pipeline: 'Recrutement', column: 'SOURCING A FAIRE' },
  non: { pipeline: 'Closing', column: 'DEMO PREVUE' },
} as const;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { choice } = await req.json();
    if (choice !== 'oui' && choice !== 'non') {
      return NextResponse.json({ error: 'choice invalide (attendu : oui | non)' }, { status: 400 });
    }
    const target = TARGETS[choice as 'oui' | 'non'];

    // Affaire source + tout ce qu'on veut recopier.
    const source = await prisma.deal.findUnique({
      where: { id: params.id },
      include: { store: true, jobOffers: true, notes: true, actions: true },
    });
    if (!source) {
      return NextResponse.json({ error: 'Affaire source introuvable' }, { status: 404 });
    }

    // Colonne cible (résolue par nom de pipeline + nom de colonne).
    const targetCol = await prisma.pipelineColumn.findFirst({
      where: { title: target.column, pipeline: { name: target.pipeline } },
    });
    if (!targetCol) {
      return NextResponse.json(
        { error: `Colonne « ${target.column} » du pipeline « ${target.pipeline} » introuvable` },
        { status: 404 },
      );
    }

    const created = await prisma.$transaction(async (tx) => {
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
          dealEmail: source.dealEmail,
          contactCivilite: source.contactCivilite,
          contactLastName: source.contactLastName,
          dealValue: source.dealValue,
          demoDate: source.demoDate,
          candidateCallDate: source.candidateCallDate,
          collaboratorId: source.collaboratorId,
          assignedUserId: source.assignedUserId,
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

    return NextResponse.json(
      { ok: true, dealId: created.id, target },
      { status: 201 },
    );
  } catch (err) {
    console.error('[POST /api/deals/[id]/duplicate]', err);
    return NextResponse.json({ error: 'Erreur serveur lors de la duplication' }, { status: 500 });
  }
}
