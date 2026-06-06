// src/app/api/brands/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { DEMO_MODE, demoBrands } from '@/lib/demo';

export async function GET() {
  try {
    const brands = await prisma.brand.findMany({
      include: { _count: { select: { stores: true } } },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json(brands);
  } catch (err) {
    if (DEMO_MODE) return NextResponse.json(demoBrands);
    throw err;
  }
}

export async function POST(req: NextRequest) {
  const { name, color } = await req.json();
  if (!name) return NextResponse.json({ error: 'name requis' }, { status: 400 });
  const brand = await prisma.brand.create({ data: { name, color: color || '#6366f1' } });
  return NextResponse.json(brand, { status: 201 });
}
