import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Données dynamiques (lecture DB) : jamais de cache statique du Route Handler.
export const dynamic = 'force-dynamic';

export async function GET() {
  const types = await prisma.subscriptionType.findMany({
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  });
  return NextResponse.json(types);
}

export async function POST(req: NextRequest) {
  const { name, position } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'name requis' }, { status: 400 });
  try {
    const t = await prisma.subscriptionType.create({
      data: { name: name.trim(), position: typeof position === 'number' ? position : 0 },
    });
    return NextResponse.json(t, { status: 201 });
  } catch {
    // Contrainte d'unicité sur le nom.
    return NextResponse.json({ error: 'Ce type d\'abonnement existe déjà' }, { status: 409 });
  }
}
