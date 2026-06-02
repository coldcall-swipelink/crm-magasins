import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Helper pour vérifier l'API key
function verifyApiKey(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  
  const token = authHeader.replace('Bearer ', '');
  const apiKey = process.env.API_KEY;
  
  return token === apiKey;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Vérifier l'API key
    if (!verifyApiKey(_req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
        jobOffers: true,
      },
    });

    // Vérifier si la colonne a changé et c'est "DEMO FAITE"
    if (body.columnId) {
      const newColumn = await prisma.pipelineColumn.findUnique({
        where: { id: body.columnId },
      });

      if (newColumn?.title === 'DEMO FAITE') {
        // Envoyer webhook à n8n
        try {
          await fetch('https://swipelink.app.n8n.cloud/webhook-test/9fb26a79-1402-4b4c-bc2e-9a0f1ed3263b', {
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
          console.error('Webhook error:', webhookErr);
        }
      }
    }

    return NextResponse.json(deal);
  } catch (err) {
    console.error('[PATCH /api/deals/[id]]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
