// src/app/api/campaigns/messages/route.ts
//
//   GET /api/campaigns/messages?campaignId=…&status=…&q=…&page=1
//
// Historique des emails de campagne : ce qui est parti, quand, à qui, depuis
// quelle boîte, et où en est le message (ouvert, répondu).
//
// Sert les deux écrans d'historique — celui d'une campagne (avec campaignId)
// et le général (sans) — parce que c'est la même question posée à deux
// échelles. Le corps des emails n'est pas renvoyé ici : il se lit message par
// message (cf. [id]/route.ts), sinon une page de 50 lignes pèserait des méga-octets.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/** Traduction d'un filtre d'écran en condition de base. */
function statusFilter(status: string): Prisma.CampaignMessageWhereInput {
  switch (status) {
    case 'sent':    return { status: 'sent' };
    case 'opened':  return { status: 'sent', openedAt: { not: null } };
    case 'replied': return { repliedAt: { not: null } };
    case 'failed':  return { status: 'failed' };
    default:        return {};
  }
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const campaignId = (params.get('campaignId') || '').trim();
  const status = (params.get('status') || '').trim();
  const q = (params.get('q') || '').trim();
  const page = Math.max(1, Number(params.get('page')) || 1);

  const scope: Prisma.CampaignMessageWhereInput = campaignId ? { campaignId } : {};
  const where: Prisma.CampaignMessageWhereInput = { ...scope, ...statusFilter(status) };

  if (q) {
    where.OR = [
      { toAddress: { contains: q, mode: 'insensitive' } },
      { subject:   { contains: q, mode: 'insensitive' } },
      { lead: { firstName: { contains: q, mode: 'insensitive' } } },
      { lead: { lastName:  { contains: q, mode: 'insensitive' } } },
      { lead: { company:   { contains: q, mode: 'insensitive' } } },
    ];
  }

  const [messages, total, sent, opened, replied, failed] = await Promise.all([
    prisma.campaignMessage.findMany({
      where,
      // Le plus récent d'abord : un historique se lit à l'envers.
      orderBy: { sentAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, subject: true, toAddress: true, fromAddress: true,
        status: true, stepPosition: true, variantKey: true, sentAt: true,
        openedAt: true, openCount: true, repliedAt: true, error: true,
        campaign: { select: { id: true, name: true } },
        lead: { select: { id: true, firstName: true, lastName: true, company: true, status: true } },
        mailbox: { select: { email: true } },
      },
    }),
    prisma.campaignMessage.count({ where }),
    // Décomptes des onglets : sur le périmètre (campagne ou tout), sans le
    // filtre de statut — sinon chaque onglet afficherait « son » chiffre.
    prisma.campaignMessage.count({ where: { ...scope, status: 'sent' } }),
    prisma.campaignMessage.count({ where: { ...scope, status: 'sent', openedAt: { not: null } } }),
    prisma.campaignMessage.count({ where: { ...scope, repliedAt: { not: null } } }),
    prisma.campaignMessage.count({ where: { ...scope, status: 'failed' } }),
  ]);

  return NextResponse.json({
    messages,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    counts: { sent, opened, replied, failed },
  });
}
