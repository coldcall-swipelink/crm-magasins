// src/app/api/deals/[id]/duplicate/route.ts
//
// Duplication « à l'identique » d'une affaire, dans le cadre du workflow
// « Prospection de Valeur » (déclenché quand une affaire arrive dans « Démo
// prévue » du pipeline « Prospection ») :
//   - choice = 'oui'  → Recrutement › SOURCING A FAIRE
//   - choice = 'non'  → Closing › DEMO PREVUE
//
// La duplication elle-même vit dans src/lib/dealDuplication.ts : le parcours
// « 2 CV de bouchers » l'appelle aussi, quand c'est le directeur du magasin qui
// réserve sa démo et que personne n'est devant le CRM.

import { NextRequest, NextResponse } from 'next/server';
import { duplicateDeal, PV_TARGETS } from '@/lib/dealDuplication';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { choice } = await req.json();
    if (choice !== 'oui' && choice !== 'non') {
      return NextResponse.json({ error: 'choice invalide (attendu : oui | non)' }, { status: 400 });
    }

    const result = await duplicateDeal(params.id, PV_TARGETS[choice as 'oui' | 'non']);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 404 });
    }
    return NextResponse.json({ ok: true, dealId: result.dealId, target: result.target }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/deals/[id]/duplicate]', err);
    return NextResponse.json({ error: 'Erreur serveur lors de la duplication' }, { status: 500 });
  }
}
