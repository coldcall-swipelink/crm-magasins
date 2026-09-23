import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { brandOverlapError, cleanBrandIds } from '@/lib/emailTemplateVariants';

// Déclinaisons par enseigne d'un template d'email (Paramètres → templates).

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { brandIds, subject, body } = await req.json();
  const ids = cleanBrandIds(brandIds);
  if (!ids.length) return NextResponse.json({ error: 'Choisissez au moins une enseigne' }, { status: 400 });

  const template = await prisma.emailTemplate.findUnique({ where: { id: params.id } });
  if (!template) return NextResponse.json({ error: 'Template introuvable' }, { status: 404 });

  const conflict = await brandOverlapError(params.id, ids);
  if (conflict) return NextResponse.json({ error: conflict }, { status: 400 });

  const variant = await prisma.emailTemplateVariant.create({
    data: { templateId: params.id, brandIds: ids, subject: subject || '', body: body || '' },
  });
  return NextResponse.json(variant, { status: 201 });
}
