// src/app/api/notes/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Données dynamiques (lecture DB) : jamais de cache statique du Route Handler.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const dealId = new URL(req.url).searchParams.get('dealId');
  const notes = await prisma.note.findMany({
    where: dealId ? { dealId } : undefined,
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(notes);
}

export async function POST(req: NextRequest) {
  const { dealId, content, authorId, authorName } = await req.json();
  if (!dealId || !content) return NextResponse.json({ error: 'dealId et content requis' }, { status: 400 });
  const note = await prisma.note.create({
    data: {
      dealId,
      content,
      authorId:   authorId   || null,
      authorName: authorName || '',
    },
  });
  return NextResponse.json(note, { status: 201 });
}
