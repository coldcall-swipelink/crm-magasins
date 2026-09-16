// src/app/api/campaigns/leads/route.ts
//
//   GET  /api/campaigns/leads?q=…&status=…&pipelineId=…&columnId=…&page=1
//        → liste filtrée, paginée
//   POST /api/campaigns/leads                      → création manuelle
//   POST /api/campaigns/leads { …, campaignId }    → création PUIS inscription
//         dans la campagne : c'est la saisie d'un lead depuis une campagne.
//
// La liste sert l'écran « Leads » de l'onglet Campagnes. Elle renvoie aussi le
// décompte par statut, pour que les filtres affichent leur volume sans un
// second aller-retour.
//
// Filtre par pipeline / étape : un lead repris du CRM porte l'identifiant de
// son affaire (Lead.dealId). On traduit donc le filtre en liste d'affaires
// concernées, puis on cherche les leads qui en viennent. Le détour par une
// liste d'identifiants tient au fait que Lead.dealId n'est pas une relation
// Prisma — poser une clé étrangère sur une colonne déjà remplie ferait échouer
// la synchronisation de schéma au moindre rattachement orphelin.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isLeadStatus, isValidEmail, normalizeEmail } from '@/lib/campaigns/leadFields';
import { enrollLeads } from '@/lib/campaigns/engine';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  try {
    return await listLeads(req);
  } catch (err) {
    // Une liste qui échoue ne doit JAMAIS ressembler à une liste vide : dire
    // « aucun lead » quand la requête est tombée, c'est annoncer une perte de
    // données qui n'a pas eu lieu. On renvoie l'erreur telle quelle, à charge
    // pour l'écran de l'afficher.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/campaigns/leads]', err);

    // Cas connu : le schéma de la base est en retard sur le code déployé (une
    // colonne ajoutée par une mise en production dont la synchronisation n'a
    // pas abouti). Les leads sont intacts — seule la lecture échoue.
    const missingColumn = /column .* does not exist|P2022/i.test(message);
    return NextResponse.json({
      error: missingColumn
        ? "La base est en retard sur l'application : une colonne ajoutée par la "
          + 'dernière mise en production manque encore. Vos leads sont intacts, '
          + "ils ne peuvent simplement pas être lus. Ouvrez /api/admin/db-sync?token=sync-crm-2026 "
          + 'pour rattraper le schéma, puis rechargez cette page.'
        : `Lecture des leads impossible : ${message}`,
      detail: message,
    }, { status: 500 });
  }
}

async function listLeads(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const q = (params.get('q') || '').trim();
  const status = (params.get('status') || '').trim();
  const importId = (params.get('importId') || '').trim();
  const pipelineId = (params.get('pipelineId') || '').trim();
  const columnId = (params.get('columnId') || '').trim();
  const page = Math.max(1, Number(params.get('page')) || 1);

  const where: Prisma.LeadWhereInput = {};
  if (status && isLeadStatus(status)) where.status = status;
  if (importId) where.importId = importId;
  if (q) {
    // Recherche sur les champs qu'on lit à l'œil dans la liste.
    where.OR = [
      { email:          { contains: q, mode: 'insensitive' } },
      { firstName:      { contains: q, mode: 'insensitive' } },
      { lastName:       { contains: q, mode: 'insensitive' } },
      { contactCalling: { contains: q, mode: 'insensitive' } },
      { company:        { contains: q, mode: 'insensitive' } },
      { jobTitle:       { contains: q, mode: 'insensitive' } },
      { city:           { contains: q, mode: 'insensitive' } },
    ];
  }

  if (pipelineId || columnId) {
    const deals = await prisma.deal.findMany({
      where: {
        ...(pipelineId ? { pipelineId } : {}),
        ...(columnId ? { columnId } : {}),
      },
      select: { id: true },
    });
    // Aucune affaire dans ce périmètre : la liste est vide, et le dire par un
    // `in: []` évite d'aller chercher des leads qu'on écarterait ensuite.
    where.dealId = { in: deals.map(deal => deal.id) };
  }

  const [rows, total, statusCounts] = await Promise.all([
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

  // Où en est l'affaire de chaque lead affiché. Une seule requête, bornée à la
  // page en cours : c'est l'information qui manquait pour savoir, depuis
  // l'écran Leads, si l'on s'apprête à relancer une affaire déjà en démo.
  const leads = await withCrmStage(rows);

  return NextResponse.json({
    leads,
    total,
    page,
    pageSize: PAGE_SIZE,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    statusCounts: Object.fromEntries(statusCounts.map(c => [c.status, c._count._all])),
  });
}

/** Étape du pipeline de l'affaire liée, ajoutée aux leads d'une page. */
async function withCrmStage<T extends { dealId: string | null }>(leads: T[]) {
  const dealIds = Array.from(new Set(leads.map(lead => lead.dealId).filter((id): id is string => !!id)));
  if (dealIds.length === 0) return leads.map(lead => ({ ...lead, crm: null }));

  const deals = await prisma.deal.findMany({
    where: { id: { in: dealIds } },
    select: {
      id: true,
      pipeline: { select: { id: true, name: true } },
      column: { select: { id: true, title: true, color: true } },
    },
  });
  const byId = new Map(deals.map(deal => [deal.id, deal]));

  return leads.map(lead => {
    const deal = lead.dealId ? byId.get(lead.dealId) : undefined;
    return {
      ...lead,
      // `null` distingue « pas d'affaire liée » de « affaire liée, étape
      // inconnue » — la première est normale pour un lead importé d'un CSV.
      crm: deal
        ? {
            dealId: deal.id,
            pipeline: deal.pipeline.name,
            column: deal.column.title,
            color: deal.column.color,
          }
        : null,
    };
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
      contactCalling: text(body.contactCalling),
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
