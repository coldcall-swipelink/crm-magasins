// src/app/api/deals/[id]/campaign-leads/route.ts
//
//   GET /api/deals/<id>/campaign-leads
//
// Les leads de prospection qui correspondent à cette affaire : rattachés
// explicitement, ou de même enseigne et même ville (cf. crmMatch.ts).
//
// Sert le bloc « Leads de campagne » de la fiche affaire : savoir, avant
// d'appeler, qu'une séquence d'emails tourne déjà sur ce magasin.

import { NextResponse } from 'next/server';
import { matchLeadsForDeal } from '@/lib/campaigns/crmMatch';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const leads = await matchLeadsForDeal(params.id);
    return NextResponse.json({ leads });
  } catch (err) {
    // Le bloc est un confort : une table de campagnes absente ne doit pas
    // casser la fiche affaire. On renvoie l'erreur, l'écran la tait.
    console.error('[GET /api/deals/[id]/campaign-leads]', err);
    return NextResponse.json({ leads: [], error: 'Leads de campagne indisponibles' });
  }
}
