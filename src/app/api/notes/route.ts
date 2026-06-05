// src/app/api/notes/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Route API dynamique : exécutée à chaque requête (lit la base de données),
// jamais pré-générée au build.
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
  const { dealId, content } = await req.json();
  if (!dealId || !content) return NextResponse.json({ error: 'dealId et content requis' }, { status: 400 });
  const note = await prisma.note.create({ data: { dealId, content } });
  return NextResponse.json(note, { status: 201 });
}
