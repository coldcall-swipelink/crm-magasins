// src/app/api/brands/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Données dynamiques (lecture DB) : jamais de cache statique du Route Handler.
export const dynamic = 'force-dynamic';

export async function GET() {
  const brands = await prisma.brand.findMany({
    include: { _count: { select: { stores: true } } },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json(brands);
}

export async function POST(req: NextRequest) {
  const { name, color } = await req.json();
  if (!name) return NextResponse.json({ error: 'name requis' }, { status: 400 });
  const brand = await prisma.brand.create({ data: { name, color: color || '#6366f1' } });
  return NextResponse.json(brand, { status: 201 });
}
