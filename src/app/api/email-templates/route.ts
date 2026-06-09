import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Données dynamiques (lecture DB) : jamais de cache statique du Route Handler.
export const dynamic = 'force-dynamic';

export async function GET() {
  const templates = await prisma.emailTemplate.findMany({ orderBy: { name: 'asc' } });
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const { name, subject, body } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'name requis' }, { status: 400 });
  const t = await prisma.emailTemplate.create({
    data: { id: `tpl-${Date.now()}`, name: name.trim(), subject: subject || '', body: body || '' },
  });
  return NextResponse.json(t, { status: 201 });
}
