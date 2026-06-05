// src/app/api/import-batches/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Données live : ne jamais pré-générer au build (évite tout accès DB à la compilation).
export const dynamic = 'force-dynamic';

export async function GET() {
  const batches = await prisma.importBatch.findMany({
    include: { importRows: { orderBy: { rowNumber: 'asc' }, include: { store: { select: { name: true } } } } },
    orderBy: { importedAt: 'desc' },
  });
  return NextResponse.json(batches);
}
