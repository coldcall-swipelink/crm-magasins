import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Marque / démarque un candidat comme « appelé » pour ce deal (case à cocher de
// l'onglet Recrutement). candidateId = id du Candidate dans la base produit.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const candidateId = typeof body?.candidateId === 'string' ? body.candidateId : '';
    const called = Boolean(body?.called);
    if (!candidateId) {
      return NextResponse.json({ error: 'candidateId requis' }, { status: 400 });
    }

    if (called) {
      await prisma.candidateCall.upsert({
        where: { dealId_candidateId: { dealId: params.id, candidateId } },
        create: { dealId: params.id, candidateId },
        update: { calledAt: new Date() },
      });
    } else {
      await prisma.candidateCall.deleteMany({
        where: { dealId: params.id, candidateId },
      });
    }

    return NextResponse.json({ ok: true, candidateId, called });
  } catch (err) {
    console.error('CandidateCall toggle error:', err);
    return NextResponse.json({ error: 'Erreur lors de la mise à jour' }, { status: 500 });
  }
}
