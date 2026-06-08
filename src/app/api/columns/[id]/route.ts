// src/app/api/columns/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    // On ne met à jour que les champs explicitement fournis et bien typés.
    const data: { title?: string; color?: string; position?: number } = {};
    if (typeof body.title === 'string') data.title = body.title;
    if (typeof body.color === 'string') data.color = body.color;
    if (typeof body.position === 'number') data.position = body.position;

    const col = await prisma.pipelineColumn.update({ where: { id: params.id }, data });
    return NextResponse.json(col);
  } catch (err) {
    console.error('[PATCH /api/columns/[id]]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const count = await prisma.deal.count({ where: { columnId: params.id } });
  if (count > 0) return NextResponse.json({ error: 'Colonne non vide — déplacez les affaires d\'abord.' }, { status: 409 });
  await prisma.pipelineColumn.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
