// src/app/api/calls/[id]/route.ts
// Réponse à la question « Est-ce que le décisionnaire a pu être contacté ? »
// posée 10 s après le dévoilement d'un numéro. Met à jour la ligne CallLog
// créée par /api/deals/[id]/reveal-phone.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { USE_MOCK_DATA } from '@/lib/mockData';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  if (typeof body?.connected !== 'boolean') {
    return NextResponse.json({ error: 'connected (booléen) requis' }, { status: 400 });
  }
  const connected = body.connected;

  if (USE_MOCK_DATA) return NextResponse.json({ ok: true, id: params.id, connected });

  try {
    // updateMany plutôt que update : un appel déjà supprimé (deal supprimé
    // entre-temps) ne doit pas faire échouer la réponse à la pop-up.
    const res = await prisma.callLog.updateMany({
      where: { id: params.id },
      data: { connected },
    });
    if (res.count === 0) return NextResponse.json({ error: 'Appel non trouvé' }, { status: 404 });

    return NextResponse.json({ ok: true, id: params.id, connected });
  } catch (err) {
    console.error('[PATCH /api/calls/[id]]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
