import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { name, email, color } = await req.json();
  const c = await prisma.collaborator.update({ where: { id: params.id }, data: { name, email, color } });
  return NextResponse.json(c);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await prisma.deal.updateMany({ where: { collaboratorId: params.id }, data: { collaboratorId: null } });
  await prisma.collaborator.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
