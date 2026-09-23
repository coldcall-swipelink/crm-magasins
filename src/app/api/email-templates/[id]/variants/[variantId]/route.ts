import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { brandOverlapError, cleanBrandIds } from '@/lib/emailTemplateVariants';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; variantId: string } },
) {
  const { brandIds, subject, body } = await req.json();
  const ids = cleanBrandIds(brandIds);
  if (!ids.length) return NextResponse.json({ error: 'Choisissez au moins une enseigne' }, { status: 400 });

  const conflict = await brandOverlapError(params.id, ids, params.variantId);
  if (conflict) return NextResponse.json({ error: conflict }, { status: 400 });

  const variant = await prisma.emailTemplateVariant.update({
    where: { id: params.variantId },
    data: { brandIds: ids, subject: subject || '', body: body || '', updatedAt: new Date() },
  });
  return NextResponse.json(variant);
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: { id: string; variantId: string } },
) {
  await prisma.emailTemplateVariant.delete({ where: { id: params.variantId } });
  return NextResponse.json({ success: true });
}
