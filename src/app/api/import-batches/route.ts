// src/app/api/import-batches/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Route dépendante de la base : jamais de pré-génération statique au build
// (sinon une base injoignable au moment du build fait échouer le déploiement).
export const dynamic = 'force-dynamic';

export async function GET() {
  const batches = await prisma.importBatch.findMany({
    include: { importRows: { orderBy: { rowNumber: 'asc' }, include: { store: { select: { name: true } } } } },
    orderBy: { importedAt: 'desc' },
  });
  return NextResponse.json(batches);
}
