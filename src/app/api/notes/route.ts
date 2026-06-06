// src/app/api/notes/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { DEMO_MODE } from '@/lib/demo';

export async function GET(req: NextRequest) {
  const dealId = new URL(req.url).searchParams.get('dealId');
  try {
    const notes = await prisma.note.findMany({
      where: dealId ? { dealId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(notes);
  } catch (err) {
    if (DEMO_MODE) return NextResponse.json([]);
    throw err;
  }
}

export async function POST(req: NextRequest) {
  const { dealId, content, authorId, authorName } = await req.json();
  if (!dealId || !content) return NextResponse.json({ error: 'dealId et content requis' }, { status: 400 });
  try {
    const note = await prisma.note.create({
      data: {
        dealId,
        content,
        authorId:   authorId   || null,
        authorName: authorName || '',
      },
    });
    return NextResponse.json(note, { status: 201 });
  } catch (err) {
    if (DEMO_MODE) return NextResponse.json({ id: `demo-note-${Date.now()}`, dealId, content, authorName, createdAt: new Date().toISOString(), demo: true }, { status: 201 });
    throw err;
  }
}
