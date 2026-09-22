// src/app/api/objectives/route.ts
// Suivi des objectifs d'UN utilisateur : ses cibles fixées dans Smartlink
// Brain, face à son réalisé calculé ici, à la source.
//
// GET /api/objectives?userId=…[&period=2026-W39]
//
// Le réalisé reprend les conventions de comptage de Brain, pour que le chiffre
// vu ici et le même chiffre dans l'onglet Objectifs de Brain ne se
// contredisent jamais :
//   - appels : une ligne de CallLog = un appel, datée calledAt ;
//   - décisionnaires joints : les mêmes lignes, connected = true ;
//   - démos : une ligne de DemoBooking = une démo, datée bookedAt (la PRISE de
//     rendez-vous, pas la démo elle-même) ;
//   - closings : abonnements closés non résiliés, datés closingDate,
//     DÉDOUBLONNÉS par affaire (trois abonnements signés le même mois par un
//     client = un closing), crédités au closeur (closedByUserId/closedByName,
//     à défaut l'assigné de l'affaire).
//
// L'attribution suit la même règle que Brain : l'identifiant fait foi quand il
// est là (la jointure User donne le nom de référence), le nom figé sur la
// ligne sert de repli pour les lignes d'avant les comptes utilisateurs.
// Les journées se comptent dans le fuseau de l'équipe (Europe/Paris), pas en
// UTC : un appel passé lundi à 00h30 appartient au lundi.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { USE_MOCK_DATA } from '@/lib/mockData';
import {
  fetchBrainGoals,
  foldPersonName,
  objectivePeriods,
  targetFor,
  tzDate,
  type ObjectivePeriod,
} from '@/lib/objectives';

// Live : jamais pré-généré au build (pas d'accès DB à la compilation).
export const dynamic = 'force-dynamic';

interface Actuals {
  calls: number;
  connected: number;
  demos: number;
  closings: number;
  /** MRR closé sur la période (somme des abonnements crédités, en €/mois). */
  closingsValue: number;
}

/**
 * Bornes LARGES en UTC autour d'une période Paris : un jour de marge de chaque
 * côté, puis chaque événement est rangé précisément par sa date murale
 * (tzDate) — la même mécanique que le tally de Brain. Filtrer en SQL sur des
 * instants UTC nus décalerait les événements de fin de soirée d'un jour.
 */
function wideBounds(period: ObjectivePeriod): { gte: Date; lt: Date } {
  return {
    gte: new Date(new Date(`${period.from}T00:00:00Z`).getTime() - 86_400_000),
    lt: new Date(new Date(`${period.to}T00:00:00Z`).getTime() + 2 * 86_400_000),
  };
}

const inPeriod = (at: Date, period: ObjectivePeriod) => {
  const ymd = tzDate(at);
  return ymd >= period.from && ymd <= period.to;
};

async function computeActuals(
  user: { id: string; name: string },
  period: ObjectivePeriod,
): Promise<Actuals> {
  const range = wideBounds(period);
  const fold = foldPersonName(user.name);
  // L'identifiant fait foi ; une ligne sans identifiant (d'avant les comptes,
  // ou dont l'utilisateur a été supprimé) se rattache par son nom figé.
  const isMine = (userId: string | null, userName: string) =>
    userId ? userId === user.id : foldPersonName(userName) === fold;

  const [calls, demos, subs] = await Promise.all([
    prisma.callLog.findMany({
      where: {
        calledAt: range,
        OR: [{ userId: user.id }, { userId: null }],
      },
      select: { userId: true, userName: true, calledAt: true, connected: true },
    }),
    prisma.demoBooking.findMany({
      where: {
        bookedAt: range,
        OR: [{ userId: user.id }, { userId: null }],
      },
      select: { userId: true, userName: true, bookedAt: true },
    }),
    // Tous les abonnements closés de la période : le crédit peut passer par le
    // nom du closeur ou par l'assigné de l'affaire, deux chemins que le SQL de
    // Prisma ne sait pas replier — le tri se fait ici, le volume est petit.
    prisma.subscription.findMany({
      where: { closingDate: range, churned: false },
      select: {
        dealId: true,
        value: true,
        closingDate: true,
        closedByUserId: true,
        closedByName: true,
        closedByUser: { select: { name: true } },
        deal: { select: { assignedUserId: true, assignedUser: { select: { name: true } } } },
      },
    }),
  ]);

  const myCalls = calls.filter(c => inPeriod(c.calledAt, period) && isMine(c.userId, c.userName));
  const myDemos = demos.filter(d => inPeriod(d.bookedAt, period) && isMine(d.userId, d.userName));

  // Un closing est crédité comme dans Brain : le closeur désigné (l'identifiant
  // joint sur User prime, le nom figé sert de repli), à défaut l'assigné de
  // l'affaire. Compté par affaire, pas par abonnement.
  const closedDeals = new Set<string>();
  let closingsValue = 0;
  for (const s of subs) {
    if (!s.closingDate || !inPeriod(s.closingDate, period)) continue;
    const creditName = s.closedByUser?.name || s.closedByName || s.deal?.assignedUser?.name || '';
    const mine = s.closedByUserId
      ? s.closedByUserId === user.id
      : creditName !== '' && foldPersonName(creditName) === fold;
    if (!mine) continue;
    closedDeals.add(s.dealId);
    closingsValue += s.value ?? 0;
  }

  return {
    calls: myCalls.length,
    connected: myCalls.filter(c => c.connected === true).length,
    demos: myDemos.length,
    closings: closedDeals.size,
    closingsValue: Math.round(closingsValue * 100) / 100,
  };
}

/** Données fictives : de quoi prévisualiser la page sans base ni Brain. */
function mockPayload(periods: ObjectivePeriod[], period: ObjectivePeriod, userName: string) {
  const scale = { week: 1, month: 4.3, quarter: 13, year: 52 }[period.type];
  const done = period.past ? 1 : period.elapsed;
  const calls = Math.round(160 * scale * done);
  const connected = Math.round(calls * 0.32);
  const demos = Math.round(calls * 0.08);
  const closings = Math.round(6 * scale * done * 0.4);
  return {
    periods,
    period,
    user: { name: userName, person: userName },
    brain: { available: true, computedAt: new Date().toISOString() },
    targets: {
      calls: Math.round(200 * scale),
      demos: Math.round(16 * scale),
      closings: Math.round(2 * scale),
    },
    actuals: { calls, connected, demos, closings, closingsValue: closings * 250 },
    generatedAt: new Date().toISOString(),
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const userId = params.get('userId') || '';
  const wantedKey = params.get('period');

  const today = tzDate(new Date());
  const periods = objectivePeriods(today);
  const period =
    (wantedKey && periods.find(p => p.key === wantedKey)) ||
    periods.find(p => p.type === 'week' && p.current)!;

  if (USE_MOCK_DATA) {
    return NextResponse.json(mockPayload(periods, period, 'Bilal Yacouti'));
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

  try {
    // Le réalisé (base locale) et les cibles (Brain) se lisent en parallèle :
    // aucun des deux n'a besoin de l'autre, et la page attend le plus lent.
    const [actuals, brain] = await Promise.all([
      computeActuals(user, period),
      fetchBrainGoals(),
    ]);

    // La personne côté Brain : le nom de l'équipe Sales qui replie comme le
    // nôtre. Null = pas d'objectifs individuels prévus pour cet utilisateur.
    const person = brain.available
      ? brain.data.team.find(n => foldPersonName(n) === foldPersonName(user.name)) ?? null
      : null;

    const targets = brain.available
      ? {
          calls: targetFor(brain.data, 'calls', period.key, user.name),
          demos: targetFor(brain.data, 'demos', period.key, user.name),
          closings: targetFor(brain.data, 'closings', period.key, user.name),
        }
      : { calls: null, demos: null, closings: null };

    return NextResponse.json({
      periods,
      period,
      user: { id: user.id, name: user.name, person },
      brain: brain.available
        ? { available: true, computedAt: brain.data.computedAt }
        : { available: false, reason: brain.reason },
      targets,
      actuals,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
