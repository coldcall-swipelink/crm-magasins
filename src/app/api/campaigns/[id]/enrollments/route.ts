// src/app/api/campaigns/[id]/enrollments/route.ts
//
//   GET  /api/campaigns/<id>/enrollments?status=…&q=…  → les leads de la
//        campagne, avec l'avancement de chacun
//   POST /api/campaigns/<id>/enrollments               → en inscrit de
//        nouveaux, par liste d'identifiants ou par filtre de recherche
//
// Inscrire par filtre reprend exactement la recherche de l'écran Leads : ce
// qu'on voit à l'écran est ce qu'on inscrit.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { enrollLeads } from '@/lib/campaigns/engine';
import { isLeadStatus } from '@/lib/campaigns/leadFields';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PAGE_SIZE = 50;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const search = req.nextUrl.searchParams;
  const status = (search.get('status') || '').trim();
  const q = (search.get('q') || '').trim();
  const page = Math.max(1, Number(search.get('page')) || 1);

  const where: Prisma.CampaignEnrollmentWhereInput = { campaignId: params.id };
  if (status) where.status = status;
  if (q) {
    where.lead = {
      OR: [
        { email:     { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName:  { contains: q, mode: 'insensitive' } },
        { company:   { contains: q, mode: 'insensitive' } },
      ],
    };
  }

  const [enrollments, total, byStatus] = await Promise.all([
    prisma.campaignEnrollment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        lead: { select: { id: true, email: true, civility: true, firstName: true, lastName: true, company: true, status: true } },
        mailbox: { select: { email: true } },
        messages: {
          where: { status: 'sent' },
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: { sentAt: true, openedAt: true, repliedAt: true, stepPosition: true },
        },
      },
    }),
    prisma.campaignEnrollment.count({ where }),
    prisma.campaignEnrollment.groupBy({
      by: ['status'], where: { campaignId: params.id }, _count: { _all: true },
    }),
  ]);

  return NextResponse.json({
    enrollments,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    statusCounts: Object.fromEntries(byStatus.map(row => [row.status, row._count._all])),
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });

  let leadIds: string[] = Array.isArray(body.leadIds) ? body.leadIds.map((id: unknown) => String(id)) : [];

  // Inscription par filtre : on résout la sélection côté serveur pour ne pas
  // faire transiter des milliers d'identifiants.
  if (!leadIds.length && body.filter) {
    const filter = body.filter as { q?: string; status?: string; importId?: string };
    const where: Prisma.LeadWhereInput = {};
    if (filter.status && isLeadStatus(filter.status)) where.status = filter.status;
    if (filter.importId) where.importId = String(filter.importId);
    if (filter.q) {
      where.OR = [
        { email:     { contains: filter.q, mode: 'insensitive' } },
        { firstName: { contains: filter.q, mode: 'insensitive' } },
        { lastName:  { contains: filter.q, mode: 'insensitive' } },
        { company:   { contains: filter.q, mode: 'insensitive' } },
        { jobTitle:  { contains: filter.q, mode: 'insensitive' } },
        { city:      { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    // Garde-fou : au-delà, mieux vaut plusieurs lots que l'expiration de la
    // requête au milieu de l'inscription.
    const leads = await prisma.lead.findMany({ where, select: { id: true }, take: 5000 });
    leadIds = leads.map(lead => lead.id);
  }

  if (!leadIds.length) return NextResponse.json({ error: 'Aucun lead sélectionné' }, { status: 400 });

  try {
    const result = await enrollLeads(params.id, leadIds);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
