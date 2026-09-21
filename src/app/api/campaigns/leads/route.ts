// src/app/api/campaigns/leads/route.ts
//
//   GET  /api/campaigns/leads?q=…&status=…&company=…&jobTitle=…&pipelineId=…
//        &columnIds=a,b&page=1 → liste filtrée, paginée (`columnId=…` reste
//        accepté pour une seule étape)
//   POST /api/campaigns/leads                      → création manuelle
//   POST /api/campaigns/leads { …, campaignId }    → création PUIS inscription
//         dans la campagne : c'est la saisie d'un lead depuis une campagne.
//
// La liste sert l'écran « Leads » de l'onglet Campagnes. Elle renvoie aussi le
// décompte par statut, par enseigne et par poste, pour que les filtres
// affichent leur volume sans un second aller-retour.
//
// Chaque lead porte sa situation dans le CRM (`crm`) : l'affaire dont il vient
// quand il y est rattaché, sinon l'affaire de même enseigne et même ville
// (cf. crmMatch.ts) — le garde-fou contre le mail écrit à un magasin qu'on a
// déjà au téléphone.
//
// Filtre par pipeline / étapes : cf. src/lib/campaigns/crmScope.ts. Le même
// périmètre sert à l'inscription par filtre dans une campagne, pour que ce
// qu'on voit soit ce qu'on inscrit.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isLeadStatus, isValidEmail, normalizeEmail } from '@/lib/campaigns/leadFields';
import { enrollLeads } from '@/lib/campaigns/engine';
import { leadWhereForCrmScope, parseIds } from '@/lib/campaigns/crmScope';
import { matchDealsForLeads } from '@/lib/campaigns/crmMatch';

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
    const schemaLag = /does not exist|P2021|P2022/i.test(message);
    return NextResponse.json({
      error: schemaLag
        ? "La base est en retard sur l'application : une colonne ajoutée par la "
          + 'dernière mise en production manque encore. Vos leads sont intacts, '
          + 'ils ne peuvent simplement pas être lus.'
        : `Lecture des leads impossible : ${message}`,
      // L'écran s'en sert pour proposer le rattrapage en un clic.
      schemaLag,
      detail: message,
    }, { status: 500 });
  }
}

async function listLeads(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const q = (params.get('q') || '').trim();
  const status = (params.get('status') || '').trim();
  const importId = (params.get('importId') || '').trim();
  // Enseigne : le champ `company` du lead, tel qu'il est écrit (comparé sans
  // tenir compte de la casse). C'est l'enseigne du magasin pour un lead repris
  // du CRM, la colonne « Enseigne » pour un lead importé d'un fichier.
  const company = (params.get('company') || '').trim();
  // Poste du contact, tel qu'il est écrit sur le lead (« Directeur », « RH »…).
  const jobTitle = (params.get('jobTitle') || '').trim();
  const pipelineId = (params.get('pipelineId') || '').trim();
  // Plusieurs étapes à la fois (« a,b,c »), ou une seule par l'ancien paramètre.
  const columnIds = parseIds(params.get('columnIds')) ?? parseIds(params.get('columnId'));
  const page = Math.max(1, Number(params.get('page')) || 1);

  const where: Prisma.LeadWhereInput = {};
  if (status && isLeadStatus(status)) where.status = status;
  if (importId) where.importId = importId;
  if (company) where.company = { equals: company, mode: 'insensitive' };
  if (jobTitle) where.jobTitle = { equals: jobTitle, mode: 'insensitive' };
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

  Object.assign(where, await leadWhereForCrmScope({ pipelineId: pipelineId || undefined, columnIds }));

  const [rows, total, statusCounts, companyCounts, jobCounts] = await Promise.all([
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
    // Enseignes présentes dans la recherche, filtre d'enseigne exclu (sinon la
    // liste se réduirait à l'enseigne choisie et on ne pourrait plus en
    // changer). Les plus fournies d'abord : ce sont celles qu'on cherche.
    prisma.lead.groupBy({
      by: ['company'],
      _count: { _all: true },
      where: { ...where, company: { not: null }, jobTitle: undefined },
      orderBy: { _count: { company: 'desc' } },
      take: 300,
    }),
    // Postes présents dans la recherche, filtre de poste exclu — même raison
    // que pour les enseignes : sinon on ne pourrait plus en changer.
    prisma.lead.groupBy({
      by: ['jobTitle'],
      _count: { _all: true },
      where: { ...where, jobTitle: { not: null } },
      orderBy: { _count: { jobTitle: 'desc' } },
      take: 300,
    }),
  ]);

  // Où en est l'affaire de chaque lead affiché, bornée à la page en cours :
  // c'est l'information qui manquait pour savoir, depuis l'écran Leads, si
  // l'on s'apprête à relancer une affaire déjà en démo. Rattachement explicite
  // d'abord, rapprochement enseigne + ville ensuite.
  const matches = await matchDealsForLeads(rows);
  const leads = rows.map(lead => ({
    ...lead,
    // `null` distingue « aucune affaire » de « affaire trouvée » — le premier
    // cas est normal pour un lead importé d'un fichier, hors du périmètre CRM.
    crm: matches.get(lead.id) ?? null,
  }));

  return NextResponse.json({
    leads,
    total,
    page,
    pageSize: PAGE_SIZE,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    statusCounts: Object.fromEntries(statusCounts.map(c => [c.status, c._count._all])),
    companies: companyCounts
      .filter(c => c.company && c.company.trim())
      .map(c => ({ name: c.company as string, count: c._count._all })),
    jobTitles: jobCounts
      .filter(c => c.jobTitle && c.jobTitle.trim())
      .map(c => ({ name: c.jobTitle as string, count: c._count._all })),
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
