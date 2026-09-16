// src/app/api/campaigns/stats/route.ts
//
//   GET /api/campaigns/stats?days=30
//
// Tableau de bord global de l'outil : l'entonnoir toutes campagnes
// confondues, la courbe jour par jour, l'état des boîtes d'envoi et le
// classement des campagnes.

import { NextRequest, NextResponse } from 'next/server';
import { globalStats } from '@/lib/campaigns/stats';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Fenêtre bornée : au-delà de 180 jours, la courbe devient illisible et la
  // lecture des messages inutilement lourde.
  const days = Math.min(180, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 30));
  return NextResponse.json({ days, stats: await globalStats(days) });
}
