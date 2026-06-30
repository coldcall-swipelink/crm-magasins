import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const data: Record<string, unknown> = {};
  if ('name' in body) data.name = String(body.name).trim();
  if ('position' in body) data.position = Number(body.position);
  try {
    const t = await prisma.subscriptionType.update({ where: { id: params.id }, data });
    return NextResponse.json(t);
  } catch {
    return NextResponse.json({ error: 'Mise à jour impossible (nom déjà utilisé ?)' }, { status: 409 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  // Le type est stocké par son nom sur les deals : la suppression n'impacte pas
  // les affaires déjà renseignées (elles conservent le libellé choisi).
  await prisma.subscriptionType.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
