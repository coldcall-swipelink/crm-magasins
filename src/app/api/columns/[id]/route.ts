// src/app/api/columns/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { title, color, position } = await req.json();
  const col = await prisma.pipelineColumn.update({ where: { id: params.id }, data: { title, color, position } });
  return NextResponse.json(col);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const count = await prisma.deal.count({ where: { columnId: params.id } });
  if (count > 0) return NextResponse.json({ error: 'Colonne non vide — déplacez les affaires d\'abord.' }, { status: 409 });
  await prisma.pipelineColumn.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
