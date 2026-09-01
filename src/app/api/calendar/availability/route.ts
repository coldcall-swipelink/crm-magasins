// src/app/api/calendar/availability/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getWeekAvailability } from '@/lib/calendarAvailability';

/**
 * Disponibilités de l'agenda Google, par semaine et en créneaux de 30 minutes.
 *
 *   GET /api/calendar/availability                → semaine en cours
 *   GET /api/calendar/availability?week=2026-09-07 → semaine de ce lundi
 *
 * Lecture seule. Si l'intégration Google n'est pas configurée, la grille est
 * renvoyée quand même (tout libre) avec `configured: false` : l'écran reste
 * lisible et dit ce qui manque, plutôt que de tomber en erreur.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const week = req.nextUrl.searchParams.get('week') || undefined;
    return NextResponse.json(await getWeekAvailability(week));
  } catch (err) {
    console.error('[GET /api/calendar/availability]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
