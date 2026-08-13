// src/app/api/deals/[id]/move/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { syncDemoMeeting } from '@/lib/googleCalendar';
import {
  provisionDemoOrganization,
  provisionSmartlinkeSupportRecruiter,
} from '@/lib/supabaseProvisioning';
import { setPrimaryClosingDate } from '@/lib/subscriptions';
import { recordDealMove } from '@/lib/dealMoves';

/** Vrai si le titre de colonne correspond à l'étape « SMARTLINKÉ »
 *  (insensible à la casse et aux accents). */
function isSmartlinkColumn(title?: string | null): boolean {
  if (!title) return false;
  return title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes('smartlink');
}

/**
 * Déplace une affaire dans une nouvelle colonne (drag & drop kanban).
 * Le déplacement manuel est toujours prioritaire — on ne touche pas à isPresentInLastImport.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { columnId, position, pvChoice, closingDate, userId, userName, source } = await req.json();
    if (!columnId) return NextResponse.json({ error: 'columnId requis' }, { status: 400 });
    const column = await prisma.pipelineColumn.findUnique({ where: { id: columnId } });
    if (!column) return NextResponse.json({ error: 'Colonne non trouvée' }, { status: 404 });

    // Étape quittée : relevée AVANT la mise à jour, sinon elle est perdue.
    const before = await prisma.deal.findUnique({
      where: { id: params.id },
      select: { columnId: true },
    });

    const deal = await prisma.deal.update({
      where: { id: params.id },
      data: {
        columnId,
        // Le pipeline suit la colonne cible (permet de changer une affaire de pipeline).
        pipelineId: column.pipelineId,
        position: position ?? 0,
        hasNewOfferFromLastImport: false,
        previousColumnId: null,
        movedToCallAt: null,
        // Réponse à la pop-up « Prospection de Valeur ? » au passage en « Démo
        // prévue » : NON → l'affaire bascule en PC (isPV = false), OUI → PV.
        ...(pvChoice === 'oui' || pvChoice === 'non' ? { isPV: pvChoice === 'oui' } : {}),
      },
      include: {
        store: { include: { brand: true } },
        collaborator: true,
        jobOffers: true,
      },
    });

    // Journal des déplacements (pipeline + colonne de départ et d'arrivée,
    // auteur). Best-effort : n'interrompt jamais le déplacement.
    await recordDealMove({
      dealId: params.id,
      fromColumnId: before?.columnId ?? null,
      toColumnId: columnId,
      userId: userId ?? null,
      userName: userName ?? '',
      source: source === 'fiche' ? 'fiche' : 'pipeline',
    });

    // Date de closing demandée au passage en « SMARTLINKÉ » : on la pose sur
    // l'abonnement principal (créé si besoin) puis on dénormalise sur le deal.
    if (closingDate !== undefined) {
      await setPrimaryClosingDate(params.id, closingDate ? new Date(closingDate) : null);
    }

    // SMARTLINKÉ (pipeline Closing) → création d'un Recruiter « Support » sur
    // l'Organization produit du deal (base Supabase). Best-effort : une erreur
    // de provisioning ne doit pas faire échouer le déplacement de l'affaire.
    if (isSmartlinkColumn(column.title)) {
      try {
        await provisionSmartlinkeSupportRecruiter(deal.id);
      } catch (provisionErr) {
        console.error('Supabase provisioning (SMARTLINKÉ) error:', provisionErr);
      }
    }

    // Webhook DEMO FAITE
    if (column.title === 'DEMO FAITE') {
      try {
        await fetch('https://swipelink.app.n8n.cloud/webhook/9fb26a79-1402-4b4c-bc2e-9a0f1ed3263b', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'deal_moved_to_demo_faite',
            dealId: deal.id,
            storeName: deal.store.name,
            brandName: deal.store.brand?.name,
            contactCivilite: deal.contactCivilite,
            contactLastName: deal.contactLastName,
            dealEmail: deal.dealEmail,
            contactCalling: deal.contactCalling,
            directeur: deal.directeur,
            dealValue: deal.dealValue,
            demoDate: deal.demoDate,
          }),
        });
      } catch (webhookErr) {
        console.error('Webhook DEMO FAITE error:', webhookErr);
      }
    }

    // Démo prévue → invitation Google Meet (contact + bilal@swipelink.fr)
    // + provisioning de la base produit Supabase (Organization, plan, Recruiter).
    // Couvre aussi le transfert du workflow « Prospection de Valeur » vers
    // Closing › DEMO PREVUE (pvChoice présent), dont le titre est en majuscules.
    // On remonte le résultat de la synchro Meet (meetSync) au client pour qu'il
    // puisse afficher un toast explicite en cas d'échec (pas de date, etc.).
    let meetSync: { ok: boolean; reason?: string; meetUrl?: string } | null = null;
    if (column.title === 'Démo prévue' || (!!pvChoice && column.title === 'DEMO PREVUE')) {
      try {
        meetSync = await syncDemoMeeting(deal.id, pvChoice);
      } catch (meetErr) {
        console.error('Google Meet (Démo prévue) error:', meetErr);
        meetSync = { ok: false, reason: String(meetErr) };
      }
      try {
        await provisionDemoOrganization(deal.id);
      } catch (provisionErr) {
        console.error('Supabase provisioning (Démo prévue) error:', provisionErr);
      }
    }

    // Webhook RELANCE 1
    if (column.title === 'RELANCE 1') {
      try {
        await fetch('https://swipelink.app.n8n.cloud/webhook/d1e052fd-e50f-4b47-bc1e-8db0ac9aadc1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'deal_moved_to_relance_1',
            dealId: deal.id,
            storeName: deal.store.name,
            brandName: deal.store.brand?.name,
            contactCivilite: deal.contactCivilite,
            contactLastName: deal.contactLastName,
            dealEmail: deal.dealEmail,
            contactCalling: deal.contactCalling,
            directeur: deal.directeur,
            dealValue: deal.dealValue,
            demoDate: deal.demoDate,
          }),
        });
      } catch (webhookErr) {
        console.error('Webhook RELANCE 1 error:', webhookErr);
      }
    }

    return NextResponse.json({ ...deal, meetSync });
  } catch (err) {
    console.error('[POST /api/deals/[id]/move]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
