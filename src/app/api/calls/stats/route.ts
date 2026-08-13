// src/app/api/calls/stats/route.ts
// Statistiques d'appels : un appel = un clic sur « Afficher le numéro » dans la
// fiche affaire (une ligne CallLog). Renvoie, pour la période demandée, le total,
// le détail par utilisateur, la série journalière et la comparaison avec la
// période précédente de même durée. Les totaux 7 / 14 / 30 / 90 jours et « tout
// l'historique » sont fournis en plus pour un aperçu immédiat.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { USE_MOCK_DATA } from '@/lib/mockData';

export const dynamic = 'force-dynamic';

// Fenêtres proposées côté Dashboard (jours). 0 = tout l'historique.
const ALLOWED_DAYS = [7, 14, 30, 90, 365, 0];

/** Début de journée locale, decalé de `days` jours dans le passé. */
function startOfDayAgo(days: number, from: Date) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

/** Clé « YYYY-MM-DD » en heure locale (les jours du graphe suivent l'agenda du commercial). */
function dayKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function GET(req: NextRequest) {
  const daysParam = Number(new URL(req.url).searchParams.get('days') ?? 30);
  const days = ALLOWED_DAYS.includes(daysParam) ? daysParam : 30;

  if (USE_MOCK_DATA) {
    return NextResponse.json({
      days, from: null, to: new Date().toISOString(),
      total: 0, previousTotal: 0, byUser: [], series: [],
      totals: { d7: 0, d14: 0, d30: 0, d90: 0, all: 0 },
      generatedAt: new Date().toISOString(),
    });
  }

  try {
    const now = new Date();
    // days = 0 → tout l'historique (pas de borne basse, pas de comparaison).
    const from = days > 0 ? startOfDayAgo(days, now) : null;
    const prevFrom = days > 0 ? startOfDayAgo(days * 2, now) : null;

    const users = await prisma.user.findMany({ select: { id: true, name: true, color: true } });
    const userById = new Map(users.map(u => [u.id, u]));

    // Un seul balayage : on charge les appels depuis le début de la période
    // précédente (ou tout l'historique) et on agrège en mémoire. Le volume
    // reste modeste (quelques appels par commercial et par jour).
    const calls = await prisma.callLog.findMany({
      where: prevFrom ? { calledAt: { gte: prevFrom } } : undefined,
      select: { userId: true, userName: true, calledAt: true },
      orderBy: { calledAt: 'asc' },
    });

    const inCurrent = (d: Date) => !from || d >= from;
    const inPrevious = (d: Date) => !!(prevFrom && from && d >= prevFrom && d < from);

    const current = calls.filter(c => inCurrent(c.calledAt));
    const previous = calls.filter(c => inPrevious(c.calledAt));

    // Détail par utilisateur. Les appels sans compte rattaché (utilisateur
    // supprimé) sont regroupés sous le nom figé au moment du clic.
    const agg = new Map<string, { userId: string | null; name: string; color: string; count: number; previousCount: number }>();
    const bucket = (c: { userId: string | null; userName: string }) => {
      const key = c.userId ?? `name:${c.userName || 'Inconnu'}`;
      let row = agg.get(key);
      if (!row) {
        const u = c.userId ? userById.get(c.userId) : undefined;
        row = {
          userId: c.userId,
          name: u?.name || c.userName || 'Utilisateur inconnu',
          color: u?.color || '#94a3b8',
          count: 0,
          previousCount: 0,
        };
        agg.set(key, row);
      }
      return row;
    };
    for (const c of current) bucket(c).count++;
    for (const c of previous) bucket(c).previousCount++;

    // Série journalière de la période courante (jours vides inclus pour un
    // graphe continu). Bornée à 365 points ; « tout l'historique » démarre au
    // premier appel enregistré.
    const seriesStart = from ?? (current.length ? new Date(current[0].calledAt) : null);
    const series: { date: string; count: number }[] = [];
    if (seriesStart) {
      const counts = new Map<string, number>();
      for (const c of current) {
        const k = dayKey(c.calledAt);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const cursor = new Date(seriesStart);
      cursor.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(0, 0, 0, 0);
      let guard = 0;
      while (cursor <= end && guard++ < 366) {
        const k = dayKey(cursor);
        series.push({ date: k, count: counts.get(k) ?? 0 });
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    // Totaux de référence (indépendants de la période sélectionnée).
    const [d7, d14, d30, d90, all] = await Promise.all([
      prisma.callLog.count({ where: { calledAt: { gte: startOfDayAgo(7, now) } } }),
      prisma.callLog.count({ where: { calledAt: { gte: startOfDayAgo(14, now) } } }),
      prisma.callLog.count({ where: { calledAt: { gte: startOfDayAgo(30, now) } } }),
      prisma.callLog.count({ where: { calledAt: { gte: startOfDayAgo(90, now) } } }),
      prisma.callLog.count(),
    ]);

    return NextResponse.json({
      days,
      from: from?.toISOString() ?? null,
      to: now.toISOString(),
      total: current.length,
      previousTotal: days > 0 ? previous.length : 0,
      byUser: Array.from(agg.values()).sort((a, b) => b.count - a.count),
      series,
      totals: { d7, d14, d30, d90, all },
      generatedAt: now.toISOString(),
    });
  } catch (err) {
    console.error('[GET /api/calls/stats]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
