import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { name, subject, body } = await req.json();
  const t = await prisma.emailTemplate.update({
    where: { id: params.id },
    data: { name, subject, body, updatedAt: new Date() },
  });
  return NextResponse.json(t);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await prisma.emailTemplate.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
