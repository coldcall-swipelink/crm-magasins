import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { content } = await req.json();
  if (!content?.trim()) return NextResponse.json({ error: 'content requis' }, { status: 400 });
  const note = await prisma.note.update({ where: { id: params.id }, data: { content } });
  return NextResponse.json(note);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await prisma.note.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
