// src/app/api/actions/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Route API dynamique : exécutée à chaque requête (lit la base de données),
// jamais pré-générée au build.
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};

    if ('title'    in body) data.title    = body.title;
    if ('type'     in body) data.type     = body.type;
    if ('dueDate'  in body) data.dueDate  = new Date(body.dueDate);
    if ('dueTime'  in body) data.dueTime  = body.dueTime;
    if ('priority' in body) data.priority = body.priority;
    if ('note'     in body) data.note     = body.note;
    if ('status'   in body) {
      data.status = body.status;
      if (body.status === 'done') data.completedAt = new Date();
      if (body.status === 'todo') data.completedAt = null;
    }

    const action = await prisma.action.update({ where: { id: params.id }, data });
    return NextResponse.json(action);
  } catch (err) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.action.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
