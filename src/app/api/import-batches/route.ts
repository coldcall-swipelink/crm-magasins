// src/app/api/import-batches/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const batches = await prisma.importBatch.findMany({
    include: { importRows: { orderBy: { rowNumber: 'asc' }, include: { store: { select: { name: true } } } } },
    orderBy: { importedAt: 'desc' },
  });
  return NextResponse.json(batches);
}
