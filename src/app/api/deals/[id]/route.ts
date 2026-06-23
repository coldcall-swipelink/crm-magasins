import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { syncDemoMeeting } from '@/lib/googleCalendar';
import { provisionDemoOrganization } from '@/lib/supabaseProvisioning';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: params.id },
      include: {
        store: { include: { brand: true } },
        column: true,
        collaborator: true,
        assignedUser: true,
        jobOffers: { orderBy: { firstSeenAt: 'desc' } },
        actions: { orderBy: { dueDate: 'asc' }, include: { assignedUser: true } },
        notes: { orderBy: { createdAt: 'desc' } },
        // Regroupement d'affaires : le deal parent (s'il est lui-même absorbé)
        // et les sous-deals qu'il absorbe (autres magasins du groupe).
        parentDeal: { include: { store: { include: { brand: true } } } },
        childDeals: {
          include: { store: { include: { brand: true } }, column: true },
          orderBy: { createdAt: 'asc' },
        },
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
                     'dealValue', 'demoDate', 'candidateCallDate', 'collaboratorId', 'assignedUserId'];
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) data[key] = body[key];
    }

    // Rattachement à un deal parent (regroupement). Validation : pas de
    // rattachement à soi-même, le parent doit exister, et on se limite à un
    // seul niveau (le parent ne doit pas être lui-même un sous-deal, et un deal
    // qui possède déjà des sous-deals ne peut pas être absorbé).
    if ('parentDealId' in body) {
      const parentId: string | null = body.parentDealId || null;
      if (parentId) {
        if (parentId === params.id) {
          return NextResponse.json({ error: 'Un deal ne peut pas se rattacher à lui-même' }, { status: 400 });
        }
        const [parent, ownChildren] = await Promise.all([
          prisma.deal.findUnique({ where: { id: parentId }, select: { id: true, parentDealId: true } }),
          prisma.deal.count({ where: { parentDealId: params.id } }),
        ]);
        if (!parent) {
          return NextResponse.json({ error: 'Affaire parente introuvable' }, { status: 404 });
        }
        if (parent.parentDealId) {
          return NextResponse.json({ error: 'L\'affaire choisie est déjà un sous-deal (un seul niveau autorisé)' }, { status: 400 });
        }
        if (ownChildren > 0) {
          return NextResponse.json({ error: 'Cette affaire possède déjà des sous-deals : détachez-les d\'abord' }, { status: 400 });
        }
      }
      data.parentDealId = parentId;
    }

    // Mise à jour optionnelle de l'enseigne (Brand) du magasin associé.
    // brandId n'est pas un champ du Deal mais du Store lié.
    if ('brandId' in body) {
      const existing = await prisma.deal.findUnique({ where: { id: params.id }, select: { storeId: true } });
      if (existing) {
        await prisma.store.update({ where: { id: existing.storeId }, data: { brandId: body.brandId || null } });
      }
    }

    const deal = await prisma.deal.update({
      where: { id: params.id }, 
      data,
      include: {
        store: { include: { brand: true } },
        column: true,
        collaborator: true,
        assignedUser: true,
        jobOffers: { orderBy: { firstSeenAt: 'desc' } },
        actions: { orderBy: { dueDate: 'asc' }, include: { assignedUser: true } },
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
        console.log('Sending DEMO FAITE webhook...');
        try {
          await fetch('https://swipelink.app.n8n.cloud/webhook/9fb26a79-1402-4b4c-bc2e-9a0f1ed3263b', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'deal_moved_to_demo_faite',
              ...deal,
            }),
          });
          console.log('DEMO FAITE webhook sent successfully');
        } catch (webhookErr) {
          console.error('DEMO FAITE webhook error:', webhookErr);
        }
      }

      // Webhook RELANCE 1
      if (newColumn?.title === 'RELANCE 1') {
        console.log('Sending RELANCE 1 webhook...');
        try {
          await fetch('https://swipelink.app.n8n.cloud/webhook/d1e052fd-e50f-4b47-bc1e-8db0ac9aadc1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'deal_moved_to_relance_1',
              ...deal,
            }),
          });
          console.log('RELANCE 1 webhook sent successfully');
        } catch (webhookErr) {
          console.error('RELANCE 1 webhook error:', webhookErr);
        }
      }
    }

    // Démo prévue → invitation Google Meet. On déclenche quand l'affaire entre
    // dans la colonne « Démo prévue » ou quand sa date de démo change alors
    // qu'elle s'y trouve déjà (mise à jour de l'événement existant).
    if (deal.column?.title === 'Démo prévue' && ('columnId' in body || 'demoDate' in body)) {
      try {
        await syncDemoMeeting(deal.id);
      } catch (meetErr) {
        console.error('Google Meet (Démo prévue) error:', meetErr);
      }
    }

    // Démo prévue → provisioning de la base produit Supabase (Organization,
    // plan, Recruiter). Uniquement à l'entrée dans la colonne (changement de
    // colonne), pas sur une simple mise à jour de la date de démo. L'opération
    // est idempotente (cf. supabaseProvisioning.ts).
    if (deal.column?.title === 'Démo prévue' && 'columnId' in body) {
      try {
        await provisionDemoOrganization(deal.id);
      } catch (provisionErr) {
        console.error('Supabase provisioning (Démo prévue) error:', provisionErr);
      }
    }

    return NextResponse.json(deal);
  } catch (err) {
    console.error('PATCH error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const existing = await prisma.deal.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });

    // Détache les éventuels sous-deals (ils réapparaissent dans le pipeline)
    // avant suppression — robuste même si la base n'a pas la contrainte FK.
    await prisma.deal.updateMany({ where: { parentDealId: params.id }, data: { parentDealId: null } });

    // Les actions, notes, emailLogs et jobOffers sont supprimés en cascade.
    // Les importRows liés voient leur dealId mis à null (relation optionnelle).
    await prisma.deal.delete({ where: { id: params.id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
