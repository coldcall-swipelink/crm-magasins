// src/app/api/campaigns/leads/route.ts
//
//   GET  /api/campaigns/leads?q=…&status=…&page=1  → liste filtrée, paginée
//   POST /api/campaigns/leads                      → création manuelle
//   POST /api/campaigns/leads { …, campaignId }    → création PUIS inscription
//         dans la campagne : c'est la saisie d'un lead depuis une campagne.
//
// La liste sert l'écran « Leads » de l'onglet Campagnes. Elle renvoie aussi le
// décompte par statut, pour que les filtres affichent leur volume sans un
// second aller-retour.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isLeadStatus, isValidEmail, normalizeEmail } from '@/lib/campaigns/leadFields';
import { enrollLeads } from '@/lib/campaigns/engine';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const q = (params.get('q') || '').trim();
  const status = (params.get('status') || '').trim();
  const importId = (params.get('importId') || '').trim();
  const page = Math.max(1, Number(params.get('page')) || 1);

  const where: Prisma.LeadWhereInput = {};
  if (status && isLeadStatus(status)) where.status = status;
  if (importId) where.importId = importId;
  if (q) {
    // Recherche sur les champs qu'on lit à l'œil dans la liste.
    where.OR = [
      { email:     { contains: q, mode: 'insensitive' } },
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName:  { contains: q, mode: 'insensitive' } },
      { company:   { contains: q, mode: 'insensitive' } },
      { jobTitle:  { contains: q, mode: 'insensitive' } },
      { city:      { contains: q, mode: 'insensitive' } },
    ];
  }

  const [leads, total, statusCounts] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.lead.count({ where }),
    // Décomptes calculés sur la recherche en cours, filtre de statut exclu :
    // sinon chaque onglet afficherait « son » chiffre et zéro pour les autres.
    prisma.lead.groupBy({
      by: ['status'],
      _count: { _all: true },
      where: { ...where, status: undefined },
    }),
  ]);

  return NextResponse.json({
    leads,
    total,
    page,
    pageSize: PAGE_SIZE,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    statusCounts: Object.fromEntries(statusCounts.map(c => [c.status, c._count._all])),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });

  const email = normalizeEmail(body.email || '');
  if (!isValidEmail(email)) return NextResponse.json({ error: 'Email invalide' }, { status: 400 });

  const campaignId = body.campaignId ? String(body.campaignId) : null;

  const text = (value: unknown) => {
    const v = String(value ?? '').trim();
    return v || null;
  };

  const exists = await prisma.lead.findUnique({ where: { email }, select: { id: true } });
  if (exists) {
    // Saisi depuis une campagne, un lead déjà connu n'est pas une erreur :
    // on l'inscrit, c'était l'intention. Depuis l'écran des leads en revanche,
    // le doublon se signale.
    if (!campaignId) {
      return NextResponse.json({ error: 'Ce lead existe déjà', leadId: exists.id }, { status: 409 });
    }
    try {
      const enrolled = await enrollLeads(campaignId, [exists.id]);
      return NextResponse.json({ lead: { id: exists.id, email }, existed: true, enrolled });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
    }
  }

  const lead = await prisma.lead.create({
    data: {
      email,
      civility:  text(body.civility),
      firstName: text(body.firstName),
      lastName:  text(body.lastName),
      jobTitle:  text(body.jobTitle),
      company:   text(body.company),
      phone:     text(body.phone),
      website:   text(body.website),
      city:      text(body.city),
      country:   text(body.country),
      customFields: (body.customFields && typeof body.customFields === 'object'
        ? body.customFields : {}) as Prisma.InputJsonValue,
      source: text(body.source) || 'Saisie manuelle',
      events: {
        create: {
          type: 'imported',
          label: 'Créé à la main',
          userName: text(body.userName),
        },
      },
    },
  });

  if (campaignId) {
    try {
      const enrolled = await enrollLeads(campaignId, [lead.id]);
      return NextResponse.json({ lead, enrolled }, { status: 201 });
    } catch (err) {
      // Le lead est créé : il ne faut pas laisser croire le contraire.
      return NextResponse.json({
        lead,
        enrollError: err instanceof Error ? err.message : String(err),
      }, { status: 201 });
    }
  }

  return NextResponse.json({ lead }, { status: 201 });
}
