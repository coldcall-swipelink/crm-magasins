// src/app/api/columns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const cols = await prisma.pipelineColumn.findMany({
    include: { _count: { select: { deals: true } } },
    orderBy: { position: 'asc' },
  });
  return NextResponse.json(cols);
}

export async function POST(req: NextRequest) {
  const { title, color, pipelineId } = await req.json();
  
  if (!title) return NextResponse.json({ error: 'title requis' }, { status: 400 });
  if (!pipelineId) return NextResponse.json({ error: 'pipelineId requis' }, { status: 400 });

  const maxPos = await prisma.pipelineColumn.aggregate({
    where: { pipelineId },
    _max: { position: true },
  });

  const col = await prisma.pipelineColumn.create({
    data: {
      pipelineId,
      title,
      color: color || '#6366f1',
      position: (maxPos._max.position ?? -1) + 1,
    },
  });

  return NextResponse.json(col, { status: 201 });
}
