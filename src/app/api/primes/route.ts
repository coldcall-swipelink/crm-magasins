// src/app/api/primes/route.ts
// La cagnotte de primes d'UN utilisateur : la part que Smartlink Brain lui
// projette sur la période de primes en cours.
//
// GET /api/primes?userId=…
//
// Tout le calcul vit dans Brain (règles, seuils, versements — voir son
// src/lib/primes.ts) : ici on ne fait que retrouver l'utilisateur parmi les
// Sales primés de l'export (rapprochement par nom replié, la règle de Brain)
// et découper ce qui le concerne — sa part, la prime d'équipe, ses versements
// passés. `person: null` = pas de cagnotte prévue pour cet utilisateur (les
// OPS, un compte d'admin…) : la pastille ne s'affiche pas, sans que ce soit
// une erreur.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { USE_MOCK_DATA } from '@/lib/mockData';
import { foldPersonName } from '@/lib/objectives';
import { fetchBrainPrimes, type BrainPrimesExport } from '@/lib/primes';

// Live : jamais pré-généré au build (pas d'accès DB à la compilation).
export const dynamic = 'force-dynamic';

/** Ce qui concerne UNE personne dans l'export : sa part, l'équipe, son versé. */
function slice(data: BrainPrimesExport, userName: string) {
  const fold = foldPersonName(userName);
  const mine = data.sales.find(p => foldPersonName(p.person) === fold) ?? null;
  // Les versements passés de la personne (la prime d'équipe peut concerner
  // quelqu'un qui n'est pas dans `sales`, mais sans part Sales la pastille ne
  // s'affiche pas : l'historique suit la même règle).
  const history = data.history
    .map(h => {
      const share = h.shares.find(s => foldPersonName(s.person) === fold);
      return share ? { key: h.key, label: h.label, short: h.short, paidAt: h.paidAt, amount: share.amount } : null;
    })
    .filter((h): h is NonNullable<typeof h> => h !== null);
  return { person: mine?.person ?? null, mine, history };
}

/** Données fictives : de quoi prévisualiser la pastille sans base ni Brain. */
function mockPayload(userName: string) {
  return {
    available: true,
    user: { name: userName },
    person: userName,
    period: {
      key: '2026-09-01', from: '2026-09-01', to: '2026-12-31',
      label: 'du 1er septembre au 31 décembre 2026', short: 'Sept. → déc. 2026',
      payLabel: 'avec la paie de janvier 2027', status: 'running' as const,
    },
    mine: {
      person: userName,
      demos: 14, byType: { hyper: 5, super: 6, proxy: 3 },
      clients: 4, amount: 100,
      pending: 3, pendingAmount: 12,
      noShows: 1, noShowLost: 4,
    },
    team: {
      reached: false, total: 6000, perPerson: 1000,
      mrr: 18_500, target: 41_667, ratio: 18_500 / 41_667,
      gapMrr: 23_167, gapCredits: 39,
      payLabel: 'avec la paie de janvier 2027', frozen: null,
    },
    history: [],
    generatedAt: new Date().toISOString(),
  };
}

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get('userId') || '';

  if (USE_MOCK_DATA) {
    return NextResponse.json(mockPayload('Bilal Yacouti'));
  }

  if (!userId) {
    return NextResponse.json({ error: 'userId manquant' }, { status: 400 });
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true },
  });
  if (!user) {
    return NextResponse.json({ error: 'Utilisateur inconnu' }, { status: 404 });
  }

  const brain = await fetchBrainPrimes();
  if (!brain.available) {
    return NextResponse.json({
      available: false,
      reason: brain.reason,
      user: { name: user.name },
      generatedAt: new Date().toISOString(),
    });
  }

  const { person, mine, history } = slice(brain.data, user.name);
  return NextResponse.json({
    available: true,
    user: { name: user.name },
    person,
    period: brain.data.period,
    mine,
    team: brain.data.team,
    history,
    generatedAt: new Date().toISOString(),
  });
}
