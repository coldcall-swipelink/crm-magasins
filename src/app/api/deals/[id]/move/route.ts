// src/app/api/deals/[id]/move/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { DEMO_MODE, demoMoveDeal } from '@/lib/demo';

/**
 * Déplace une affaire dans une nouvelle colonne (drag & drop kanban).
 * Le déplacement manuel est toujours prioritaire — on ne touche pas à isPresentInLastImport.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { columnId, position } = await req.json();
  if (!columnId) return NextResponse.json({ error: 'columnId requis' }, { status: 400 });
  try {
    const column = await prisma.pipelineColumn.findUnique({ where: { id: columnId } });
    if (!column) return NextResponse.json({ error: 'Colonne non trouvée' }, { status: 404 });
    const deal = await prisma.deal.update({
      where: { id: params.id },
      data: {
        columnId,
        position: position ?? 0,
        hasNewOfferFromLastImport: false,
        previousColumnId: null,
        movedToCallAt: null,
      },
      include: {
        store: { include: { brand: true } },
        collaborator: true,
        jobOffers: true,
      },
    });

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

    return NextResponse.json(deal);
  } catch (err) {
    if (DEMO_MODE) { demoMoveDeal(params.id, columnId); return NextResponse.json({ id: params.id, columnId, demo: true }); }
    console.error('[POST /api/deals/[id]/move]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
