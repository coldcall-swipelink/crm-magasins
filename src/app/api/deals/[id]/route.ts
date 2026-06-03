import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

    // Vérifier si la colonne a changé et c'est "DEMO FAITE"
    if (body.columnId) {
      const newColumn = await prisma.pipelineColumn.findUnique({
        where: { id: body.columnId },
      });
      console.log('Column title:', newColumn?.title);
      console.log('Is DEMO FAITE?', newColumn?.title === 'DEMO FAITE');
      
      if (newColumn?.title === 'DEMO FAITE') {
        console.log('Sending webhook...');
        try {
          await fetch('https://swipelink.app.n8n.cloud/webhook/9fb26a79-1402-4b4c-bc2e-9a0f1ed3263b', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'deal_moved_to_demo_faite',
              ...deal, // Envoie le deal complet avec toutes les relations
            }),
          });
          console.log('Webhook sent successfully');
        } catch (webhookErr) {
          console.error('Webhook error:', webhookErr);
        }
      }
    }

    return NextResponse.json(deal);
  } catch (err) {
    console.error('PATCH error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
