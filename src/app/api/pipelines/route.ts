import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { USE_MOCK_DATA, mockPipelines } from '@/lib/mockData';

// Données dynamiques (lecture DB) : jamais de cache statique du Route Handler.
export const dynamic = 'force-dynamic';

export async function GET() {
  if (USE_MOCK_DATA) return NextResponse.json({ pipelines: mockPipelines });
  try {
    const pipelines = await prisma.pipeline.findMany({
      include: {
        columns: {
          orderBy: { position: 'asc' },  // ✅ CORRECT
        },
      },
      orderBy: { position: 'asc' },
    });
    return NextResponse.json({ pipelines });
  } catch (err) {
    console.error('[GET /api/pipelines]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
