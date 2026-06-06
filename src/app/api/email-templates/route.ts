import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { DEMO_MODE, demoTemplates } from '@/lib/demo';

export async function GET() {
  try {
    const templates = await prisma.emailTemplate.findMany({ orderBy: { name: 'asc' } });
    return NextResponse.json(templates);
  } catch (err) {
    if (DEMO_MODE) return NextResponse.json(demoTemplates);
    throw err;
  }
}

export async function POST(req: NextRequest) {
  const { name, subject, body } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'name requis' }, { status: 400 });
  const t = await prisma.emailTemplate.create({
    data: { id: `tpl-${Date.now()}`, name: name.trim(), subject: subject || '', body: body || '' },
  });
  return NextResponse.json(t, { status: 201 });
}
