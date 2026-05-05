import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const collaborators = await prisma.collaborator.findMany({
    include: { _count: { select: { deals: true } } },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json(collaborators);
}

export async function POST(req: NextRequest) {
  const { name, email, color } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'name requis' }, { status: 400 });
  const c = await prisma.collaborator.create({ data: { name: name.trim(), email: email || '', color: color || '#6366f1' } });
  return NextResponse.json(c, { status: 201 });
}
