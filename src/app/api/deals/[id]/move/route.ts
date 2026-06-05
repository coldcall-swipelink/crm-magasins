// src/app/api/deals/[id]/move/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { webhooks, sendWebhook } from '@/lib/config';

// Route API dynamique : exécutée à chaque requête (lit la base de données),
// jamais pré-générée au build.
export const dynamic = 'force-dynamic';

/**
 * Déplace une affaire dans une nouvelle colonne (drag & drop kanban).
 * Le déplacement manuel est toujours prioritaire — on ne touche pas à isPresentInLastImport.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { columnId, position } = await req.json();
    if (!columnId) return NextResponse.json({ error: 'columnId requis' }, { status: 400 });
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

    const webhookPayload = {
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
    };

    // Webhook DEMO FAITE
    if (column.title === 'DEMO FAITE') {
      await sendWebhook(webhooks.demoFaite, 'DEMO FAITE', {
        event: 'deal_moved_to_demo_faite',
        ...webhookPayload,
      });
    }

    // Webhook RELANCE 1
    if (column.title === 'RELANCE 1') {
      await sendWebhook(webhooks.relance1, 'RELANCE 1', {
        event: 'deal_moved_to_relance_1',
        ...webhookPayload,
      });
    }

    return NextResponse.json(deal);
  } catch (err) {
    console.error('[POST /api/deals/[id]/move]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
