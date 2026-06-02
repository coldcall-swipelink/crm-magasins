import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const pipelines = await prisma.pipeline.findMany({
      include: {
        columns: {
          orderBy: { position: 'asc' },
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
