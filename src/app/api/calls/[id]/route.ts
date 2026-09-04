// src/app/api/calls/[id]/route.ts
// Réponse à la question « Est-ce que le décisionnaire a pu être contacté ? »
// posée 20 s après le dévoilement d'un numéro. Met à jour la ligne CallLog
// créée par /api/deals/[id]/reveal-phone.
//
// La réponse détaillée (`outcome`) est celle que la pop-up fait saisir depuis
// qu'un « Non » demande son motif : JOINT / ABSENT / REUNION / REFUS. Elle
// colore l'appel dans le calendrier de l'affaire. `connected` reste renseigné
// en miroir : c'est lui que lisent les compteurs d'appels utiles.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { USE_MOCK_DATA, mockUpdateCall } from '@/lib/mockData';
import { CALL_OUTCOME_STYLES, isCallOutcome, type CallOutcome } from '@/lib/callOutcomes';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  // Deux formes acceptées : { outcome } (pop-up actuelle) ou { connected }
  // seul (ancien appelant, ou simple « oui / non » sans motif).
  let outcome: CallOutcome | null = null;
  let connected: boolean;

  if (body?.outcome !== undefined) {
    if (!isCallOutcome(body.outcome)) {
      return NextResponse.json(
        { error: `outcome invalide (attendu : ${Object.keys(CALL_OUTCOME_STYLES).join(', ')})` },
        { status: 400 },
      );
    }
    const choisi: CallOutcome = body.outcome;
    outcome = choisi;
    connected = CALL_OUTCOME_STYLES[choisi].connected;
  } else if (typeof body?.connected === 'boolean') {
    connected = body.connected;
    // « Oui » n'a qu'un seul sens ; « non » sans motif en reste à connected.
    outcome = connected ? 'JOINT' : null;
  } else {
    return NextResponse.json({ error: 'outcome ou connected requis' }, { status: 400 });
  }

  if (USE_MOCK_DATA) {
    mockUpdateCall(params.id, connected, outcome);
    return NextResponse.json({ ok: true, id: params.id, connected, outcome });
  }

  try {
    // updateMany plutôt que update : un appel déjà supprimé (deal supprimé
    // entre-temps) ne doit pas faire échouer la réponse à la pop-up.
    const res = await prisma.callLog.updateMany({
      where: { id: params.id },
      data: { connected, outcome },
    });
    if (res.count === 0) return NextResponse.json({ error: 'Appel non trouvé' }, { status: 404 });

    return NextResponse.json({ ok: true, id: params.id, connected, outcome });
  } catch (err) {
    console.error('[PATCH /api/calls/[id]]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
