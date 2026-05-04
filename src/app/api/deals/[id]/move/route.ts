// src/app/api/deals/[id]/move/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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
        // On efface le flag de déplacement automatique puisque l'utilisateur
        // prend en main le placement manuellement
        hasNewOfferFromLastImport: false,
        previousColumnId: null,
        movedToCallAt: null,
      },
    });

    return NextResponse.json(deal);
  } catch (err) {
    console.error('[POST /api/deals/[id]/move]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
