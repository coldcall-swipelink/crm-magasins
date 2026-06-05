import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { webhooks, sendWebhook } from '@/lib/config';

// Route API dynamique : exécutée à chaque requête (lit la base de données),
// jamais pré-générée au build.
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: params.id },
      include: {
        store: { include: { brand: true } },
        column: true,
        collaborator: true,
        jobOffers: { orderBy: { firstSeenAt: 'desc' } },
        actions: { orderBy: { dueDate: 'asc' } },
        notes: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!deal) return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });
    return NextResponse.json(deal);
  } catch (err) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const allowed = ['columnId', 'priority', 'position', 'previousColumnId',
                     'directeur', 'contactCalling', 'dealEmail', 'contactCivilite', 'contactLastName',
                     'dealValue', 'demoDate', 'collaboratorId'];
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) data[key] = body[key];
    }
    const deal = await prisma.deal.update({ 
      where: { id: params.id }, 
      data,
      include: {
        store: { include: { brand: true } },
        column: true,
        collaborator: true,
        jobOffers: { orderBy: { firstSeenAt: 'desc' } },
        actions: { orderBy: { dueDate: 'asc' } },
        notes: { orderBy: { createdAt: 'desc' } },
      },
    });

    // Vérifier la colonne et envoyer les webhooks appropriés
    if (body.columnId) {
      const newColumn = await prisma.pipelineColumn.findUnique({
        where: { id: body.columnId },
      });
      console.log('Column title:', newColumn?.title);
      
      // Webhook DEMO FAITE
      if (newColumn?.title === 'DEMO FAITE') {
        await sendWebhook(webhooks.demoFaite, 'DEMO FAITE', {
          event: 'deal_moved_to_demo_faite',
          ...deal,
        });
      }

      // Webhook RELANCE 1
      if (newColumn?.title === 'RELANCE 1') {
        await sendWebhook(webhooks.relance1, 'RELANCE 1', {
          event: 'deal_moved_to_relance_1',
          ...deal,
        });
      }
    }

    return NextResponse.json(deal);
  } catch (err) {
    console.error('PATCH error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
