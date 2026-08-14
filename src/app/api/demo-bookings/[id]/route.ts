// src/app/api/demo-bookings/[id]/route.ts
// Mise à jour d'un booking de démo (table DemoBooking). Seule la case
// « NO SHOW » de la fiche affaire est modifiable : le reste de la ligne est un
// fait historique (qui a booké, quand, pour quelle date) et ne se réécrit pas.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { USE_MOCK_DATA } from '@/lib/mockData';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  if (typeof body?.noShow !== 'boolean') {
    return NextResponse.json({ error: 'noShow (booléen) requis' }, { status: 400 });
  }

  // Preview front sans base : rien à persister, on renvoie l'état demandé.
  if (USE_MOCK_DATA) {
    return NextResponse.json({ id: params.id, noShow: body.noShow, demo: true });
  }

  try {
    const booking = await prisma.demoBooking.update({
      where: { id: params.id },
      data: { noShow: body.noShow },
    });
    return NextResponse.json(booking);
  } catch (err) {
    console.error('[PATCH /api/demo-bookings/[id]]', err);
    return NextResponse.json({ error: 'Booking de démo introuvable' }, { status: 404 });
  }
}
