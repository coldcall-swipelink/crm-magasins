// src/app/api/deals/[id]/reveal-phone/route.ts
// Dévoilement du numéro de téléphone d'une affaire. Chaque appel de cette route
// = un clic sur « Afficher le numéro » dans la fiche affaire, donc +1 dans le
// compteur d'appels de l'utilisateur (une ligne CallLog). La fiche n'affiche le
// numéro qu'à partir de la réponse de cette route : le compteur suit donc les
// numéros réellement consultés.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { USE_MOCK_DATA, mockDeals } from '@/lib/mockData';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const userId = typeof body?.userId === 'string' && body.userId ? body.userId : null;
  const userName = typeof body?.userName === 'string' ? body.userName : '';

  if (USE_MOCK_DATA) {
    const deal = mockDeals.find(d => d.id === params.id) as any;
    if (!deal) return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });
    return NextResponse.json({ phone: deal.contactPhone || '', logged: false });
  }

  try {
    const deal = await prisma.deal.findUnique({
      where: { id: params.id },
      select: { id: true, contactPhone: true },
    });
    if (!deal) return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });

    const phone = deal.contactPhone || '';
    // Pas de numéro renseigné → rien à dévoiler, donc aucun appel à compter.
    if (!phone.trim()) return NextResponse.json({ phone: '', logged: false });

    // L'utilisateur peut ne plus exister en base (identité stockée côté
    // navigateur) : on retombe alors sur un log anonyme plutôt que d'échouer.
    let linkedUserId: string | null = null;
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      linkedUserId = user?.id ?? null;
    }

    const call = await prisma.callLog.create({
      data: { dealId: deal.id, userId: linkedUserId, userName: userName || '', phone },
      select: { id: true, calledAt: true },
    });

    return NextResponse.json({ phone, logged: true, callId: call.id, calledAt: call.calledAt });
  } catch (err) {
    console.error('[POST /api/deals/[id]/reveal-phone]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
