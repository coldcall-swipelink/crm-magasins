// src/app/api/campaigns/scheduled/route.ts
//
//   GET /api/campaigns/scheduled?campaignId=…&q=…&page=1
//
// Les emails À VENIR : pour chaque lead encore en séquence, le prochain envoi
// prévu, avec sa date et son heure.
//
// Ils n'existent pas encore en tant que messages — un email de campagne n'est
// écrit en base qu'au moment où il part. L'échéance se lit donc sur
// l'INSCRIPTION du lead (`nextSendAt`), et l'étape à venir est celle qui suit
// les étapes déjà envoyées.
//
// Une échéance n'est tenue que si la campagne tourne : on renvoie l'état de la
// campagne avec, pour que l'écran puisse prévenir plutôt que d'afficher une
// date qui n'arrivera jamais.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const campaignId = (params.get('campaignId') || '').trim();
  const q = (params.get('q') || '').trim();
  const page = Math.max(1, Number(params.get('page')) || 1);

  const where: Prisma.CampaignEnrollmentWhereInput = {
    // « paused » compte aussi : l'envoi est suspendu, pas annulé, et il faut
    // pouvoir le voir pour décider de reprendre.
    status: { in: ['active', 'paused'] },
    nextSendAt: { not: null },
    ...(campaignId ? { campaignId } : {}),
  };
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

  const [enrollments, total] = await Promise.all([
    prisma.campaignEnrollment.findMany({
      where,
      // Le plus imminent d'abord : un échéancier se lit dans le sens du temps.
      orderBy: { nextSendAt: 'asc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, status: true, sentSteps: true, nextSendAt: true,
        lead: { select: { id: true, email: true, firstName: true, lastName: true, company: true } },
        mailbox: { select: { email: true } },
        campaign: {
          select: {
            id: true, name: true, status: true,
            steps: { orderBy: { position: 'asc' }, select: { position: true, subject: true, delayHours: true } },
          },
        },
      },
    }),
    prisma.campaignEnrollment.count({ where }),
  ]);

  const now = new Date();
  const items = enrollments.map(enrollment => {
    // L'étape à venir est celle d'après les envois déjà faits.
    const step = enrollment.campaign.steps[enrollment.sentSteps];
    return {
      id: enrollment.id,
      scheduledAt: enrollment.nextSendAt,
      // Une échéance déjà passée signifie que le moteur n'a pas encore eu son
      // tour (cron, plage horaire, quota, espacement) : l'écran le dit ainsi.
      overdue: Boolean(enrollment.nextSendAt && enrollment.nextSendAt <= now),
      enrollmentStatus: enrollment.status,
      stepPosition: step?.position ?? enrollment.sentSteps + 1,
      stepCount: enrollment.campaign.steps.length,
      // Le sujet est encore un modèle : les variables ne sont remplacées qu'à
      // l'envoi, avec les valeurs du lead à ce moment-là.
      subjectTemplate: step?.subject ?? '',
      lead: enrollment.lead,
      mailbox: enrollment.mailbox,
      campaign: { id: enrollment.campaign.id, name: enrollment.campaign.name, status: enrollment.campaign.status },
    };
  });

  return NextResponse.json({
    items,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
