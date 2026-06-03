// src/app/api/actions/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const action = await prisma.action.findUnique({
      where: { id: params.id },
      include: { deal: { include: { store: { select: { name: true, city: true } } } } },
    });
    if (!action) return NextResponse.json({ error: 'Action non trouvée' }, { status: 404 });
    return NextResponse.json(action);
  } catch (err) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};

    if ('title'    in body) data.title    = body.title;
    if ('type'     in body) data.type     = body.type;
    if ('dueDate'  in body) data.dueDate  = new Date(`${body.dueDate}T00:00:00Z`);
    if ('dueTime'  in body) data.dueTime  = body.dueTime;
    if ('priority' in body) data.priority = body.priority;
    if ('note'     in body) data.note     = body.note;
    if ('status'   in body) {
      if (body.status !== 'todo' && body.status !== 'done') {
        return NextResponse.json({ error: 'Status invalide' }, { status: 400 });
      }
      data.status = body.status;
    }

    const action = await prisma.action.update({
      where: { id: params.id },
      data,
      include: { deal: { include: { store: { select: { name: true, city: true } } } } },
    });

    return NextResponse.json(action);
  } catch (err) {
    console.error('[PATCH /api/actions/[id]]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.action.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/actions/[id]]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
