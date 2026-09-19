// src/app/api/campaigns/[id]/enrollments/route.ts
//
//   GET  /api/campaigns/<id>/enrollments?status=…&q=…  → les leads de la
//        campagne, avec l'avancement de chacun
//   POST /api/campaigns/<id>/enrollments               → en inscrit de
//        nouveaux, par liste d'identifiants ou par filtre de recherche
//   DELETE /api/campaigns/<id>/enrollments  { enrollmentIds, userName }
//        → retire plusieurs leads de la campagne d'un coup (leurs
//        inscriptions seulement : les leads restent dans la liste générale)
//
// Inscrire par filtre reprend exactement la recherche de l'écran Leads : ce
// qu'on voit à l'écran est ce qu'on inscrit.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { enrollLeads, runDueSends } from '@/lib/campaigns/engine';
import { isLeadStatus } from '@/lib/campaigns/leadFields';
import { leadWhereForCrmScope, parseIds } from '@/lib/campaigns/crmScope';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PAGE_SIZE = 50;

/**
 * Passage court du moteur sur les boîtes d'une campagne en cours.
 * Silencieux par construction : si rien ne peut partir (campagne en
 * brouillon, hors plage horaire, quota atteint), l'inscription reste un
 * succès — le diagnostic de la campagne dira pourquoi.
 */
async function sendFirstWave(campaignId: string): Promise<number> {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true, mailboxes: { select: { mailboxId: true } } },
    });
    if (campaign?.status !== 'running') return 0;

    const result = await runDueSends({
      // Court : l'utilisateur attend la réponse de son clic.
      budgetMs: 20_000,
      mailboxIds: campaign.mailboxes.map(link => link.mailboxId),
    });
    return result.sent;
  } catch (err) {
    console.error('[campaigns/enrollments] première salve', err);
    return 0;
  }
}

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
    const filter = body.filter as {
      q?: string; status?: string; importId?: string; company?: string;
      pipelineId?: string; columnIds?: unknown;
    };
    const where: Prisma.LeadWhereInput = {};
    if (filter.status && isLeadStatus(filter.status)) where.status = filter.status;
    if (filter.importId) where.importId = String(filter.importId);
    if (filter.company) where.company = { equals: String(filter.company), mode: 'insensitive' };
    // Périmètre CRM (pipeline, colonnes) : le même que la liste affichée.
    Object.assign(where, await leadWhereForCrmScope({
      pipelineId: filter.pipelineId ? String(filter.pipelineId) : undefined,
      columnIds: parseIds(filter.columnIds),
    }));
    if (filter.q) {
      where.OR = [
        { email:     { contains: filter.q, mode: 'insensitive' } },
        { firstName: { contains: filter.q, mode: 'insensitive' } },
        { lastName:  { contains: filter.q, mode: 'insensitive' } },
        { contactCalling: { contains: filter.q, mode: 'insensitive' } },
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

    // Les premiers emails partent DANS LA FOULÉE, sans attendre le cron : un
    // lead ajouté à une campagne en cours doit se voir partir. Le reste de la
    // file suivra au rythme des garde-fous des boîtes.
    const sent = await sendFirstWave(params.id);

    return NextResponse.json({ ...result, sent }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}

/** Au-delà, mieux vaut plusieurs lots : garde-fou volontaire. */
const MAX_REMOVE = 2000;

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const enrollmentIds: string[] = Array.isArray(body?.enrollmentIds)
    ? body.enrollmentIds.map((id: unknown) => String(id)).filter(Boolean)
    : [];
  const userName = body?.userName ? String(body.userName).trim() : null;

  if (enrollmentIds.length === 0) {
    return NextResponse.json({ error: 'Aucun lead sélectionné' }, { status: 400 });
  }
  if (enrollmentIds.length > MAX_REMOVE) {
    return NextResponse.json({
      error: `Sélection trop large (${enrollmentIds.length}, maximum ${MAX_REMOVE}).`,
    }, { status: 413 });
  }

  // On ne retire que les inscriptions de CETTE campagne : un identifiant
  // d'une autre campagne glissé dans la liste est ignoré, pas exécuté.
  const enrollments = await prisma.campaignEnrollment.findMany({
    where: { id: { in: enrollmentIds }, campaignId: params.id },
    select: { id: true, leadId: true, sentSteps: true, campaign: { select: { name: true } } },
  });
  if (enrollments.length === 0) {
    return NextResponse.json({ error: 'Aucune inscription trouvée dans cette campagne' }, { status: 404 });
  }

  const ids = enrollments.map(enrollment => enrollment.id);
  const campaignName = enrollments[0].campaign.name;

  // Compté AVANT : les messages partent avec les inscriptions (Cascade), et
  // l'écran doit pouvoir dire ce que le retrait a emporté des statistiques.
  const messages = await prisma.campaignMessage.count({ where: { enrollmentId: { in: ids } } });

  // Même contrat que le retrait unitaire : l'inscription part, le lead reste,
  // et sa frise garde une ligne pour que le retrait reste lisible.
  const [result] = await prisma.$transaction([
    prisma.campaignEnrollment.deleteMany({ where: { id: { in: ids } } }),
    prisma.leadEvent.createMany({
      data: enrollments.map(enrollment => ({
        leadId: enrollment.leadId,
        type: 'stopped',
        label: `Retiré de la campagne « ${campaignName} »`,
        userName,
        payload: { campaignId: params.id, action: 'remove', sentSteps: enrollment.sentSteps },
      })),
    }),
  ]);

  return NextResponse.json({ removed: result.count, messages });
}
