import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recomputeDealFromSubscriptions } from '@/lib/subscriptions';
import { USE_MOCK_DATA, mockGetSubscriptions, mockCreateSubscription } from '@/lib/mockData';

export const dynamic = 'force-dynamic';

// Liste des abonnements d'une affaire (ordonnés par position).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  // Preview (mock) : abonnements en mémoire, pas de base de données.
  if (USE_MOCK_DATA) return NextResponse.json(mockGetSubscriptions(params.id));

  const subs = await prisma.subscription.findMany({
    where: { dealId: params.id },
    orderBy: { position: 'asc' },
  });
  return NextResponse.json(subs);
}

// Ajoute un abonnement (maximum 2 par affaire).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (USE_MOCK_DATA) {
    const { sub, error } = mockCreateSubscription(params.id);
    if (error) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json(sub, { status: 201 });
  }

  const count = await prisma.subscription.count({ where: { dealId: params.id } });
  if (count >= 2) {
    return NextResponse.json({ error: 'Maximum 2 abonnements par affaire' }, { status: 400 });
  }
  const sub = await prisma.subscription.create({ data: { dealId: params.id, position: count } });
  await recomputeDealFromSubscriptions(params.id);
  return NextResponse.json(sub, { status: 201 });
}
