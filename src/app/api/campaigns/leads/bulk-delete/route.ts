// src/app/api/campaigns/leads/bulk-delete/route.ts
//
//   POST /api/campaigns/leads/bulk-delete  { leadIds: [...] }
//
// Suppression de plusieurs leads d'un coup, depuis la sélection de l'écran
// Leads. Opération irréversible : les notes, la frise d'activité, les
// inscriptions en campagne et les emails envoyés à ces leads partent avec eux
// (suppressions en cascade du schéma). La réponse annonce donc ce qui a été
// emporté, pour que l'écran puisse le dire — et le confirmer avant.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Au-delà, mieux vaut un filtre qu'une sélection : garde-fou volontaire. */
const MAX = 2000;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const leadIds: string[] = Array.isArray(body?.leadIds)
    ? body.leadIds.map((id: unknown) => String(id)).filter(Boolean)
    : [];

  if (leadIds.length === 0) {
    return NextResponse.json({ error: 'Aucun lead sélectionné' }, { status: 400 });
  }
  if (leadIds.length > MAX) {
    return NextResponse.json({
      error: `Sélection trop large (${leadIds.length}, maximum ${MAX}).`,
    }, { status: 413 });
  }

  // Ce que la suppression va emporter, compté AVANT de supprimer.
  const [enrollments, messages] = await Promise.all([
    prisma.campaignEnrollment.count({ where: { leadId: { in: leadIds } } }),
    prisma.campaignMessage.count({ where: { leadId: { in: leadIds } } }),
  ]);

  const result = await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });

  return NextResponse.json({
    deleted: result.count,
    enrollments,
    messages,
  });
}
