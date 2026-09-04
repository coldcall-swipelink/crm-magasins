// src/app/api/deals/[id]/calls/route.ts
// Journal des appels d'une affaire, pour le calendrier de sa fiche. Chaque
// ligne = un clic sur « Afficher le numéro » (cf. reveal-phone), avec le
// résultat renseigné par la pop-up qui suit l'appel.
//
//   GET /api/deals/<id>/calls              → les 12 derniers mois
//   GET /api/deals/<id>/calls?month=2026-09 → ce seul mois
//
// Le mois est cadré sur l'heure du serveur (Europe/Paris en production) : le
// calendrier affiche les mêmes jours que ceux qu'on lit dans le fil d'activité.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { USE_MOCK_DATA, mockGetCalls } from '@/lib/mockData';

export const dynamic = 'force-dynamic';

/** Bornes [début, fin[ du mois « YYYY-MM », ou null si le format ne colle pas. */
function moisEnBornes(mois: string): { debut: Date; fin: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mois);
  if (!m) return null;
  const annee = Number(m[1]);
  const index = Number(m[2]) - 1;
  if (index < 0 || index > 11) return null;
  return { debut: new Date(annee, index, 1), fin: new Date(annee, index + 1, 1) };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const moisDemande = req.nextUrl.searchParams.get('month');
  if (USE_MOCK_DATA) return NextResponse.json({ calls: mockGetCalls(params.id, moisDemande) });

  const mois = moisDemande;
  let calledAt: { gte: Date; lt?: Date };
  if (mois) {
    const bornes = moisEnBornes(mois);
    if (!bornes) return NextResponse.json({ error: 'month attendu au format YYYY-MM' }, { status: 400 });
    calledAt = { gte: bornes.debut, lt: bornes.fin };
  } else {
    const debut = new Date();
    debut.setMonth(debut.getMonth() - 12);
    calledAt = { gte: debut };
  }

  try {
    const calls = await prisma.callLog.findMany({
      where: { dealId: params.id, calledAt },
      orderBy: { calledAt: 'desc' },
      // Garde-fou : une affaire très travaillée ne doit pas renvoyer un mois
      // entier de journal d'un coup. Au-delà, on remonte les plus récents.
      take: 500,
      select: { id: true, calledAt: true, userName: true, phone: true, connected: true, outcome: true },
    });
    return NextResponse.json({ calls });
  } catch (err) {
    console.error('[GET /api/deals/[id]/calls]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
