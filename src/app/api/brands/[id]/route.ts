// src/app/api/brands/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { name, color } = await req.json();
  const brand = await prisma.brand.update({ where: { id: params.id }, data: { name, color } });
  return NextResponse.json(brand);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await prisma.brand.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
