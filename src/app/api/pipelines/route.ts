import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { DEMO_MODE, demoPipelines } from '@/lib/demo';

export async function GET() {
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
    if (DEMO_MODE) return NextResponse.json({ pipelines: demoPipelines });
    console.error('[GET /api/pipelines]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
