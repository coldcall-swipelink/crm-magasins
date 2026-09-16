// src/app/api/campaigns/leads/[id]/route.ts
//
//   GET    /api/campaigns/leads/<id>  → fiche complète (notes + frise)
//   PATCH  /api/campaigns/leads/<id>  → modification / changement de statut
//   DELETE /api/campaigns/leads/<id>  → suppression
//
// Tout changement de statut est journalisé dans la frise du lead : la fiche
// doit pouvoir raconter qui a marqué le lead « pas intéressé », et quand.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isLeadStatus, isValidEmail, normalizeEmail, statusLabel } from '@/lib/campaigns/leadFields';
import { applyLeadToDeal, previewLeadToDeal } from '@/lib/campaigns/crmLink';

export const dynamic = 'force-dynamic';

const FULL_LEAD = {
  include: {
    notes:  { orderBy: { createdAt: 'desc' } },
    events: { orderBy: { createdAt: 'desc' }, take: 100 },
    import: { select: { id: true, filename: true, createdAt: true } },
    // Séquences en cours ou passées du lead : la fiche doit permettre de
    // l'arrêter sans passer par la campagne.
    enrollments: {
      orderBy: { createdAt: 'desc' },
      include: {
        campaign: { select: { id: true, name: true, status: true } },
        mailbox:  { select: { email: true } },
      },
    },
    // Ses réponses, telles qu'elles ont été relevées dans les boîtes.
    replies: { orderBy: { receivedAt: 'desc' }, take: 10 },
  },
} satisfies Prisma.LeadDefaultArgs;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const lead = await prisma.lead.findUnique({ where: { id: params.id }, ...FULL_LEAD });
  if (!lead) return NextResponse.json({ error: 'Lead introuvable' }, { status: 404 });
  return NextResponse.json({ lead });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const existing = await prisma.lead.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: 'Lead introuvable' }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });

  const userName = body.userName ? String(body.userName).trim() : null;
  const data: Prisma.LeadUpdateInput = {};

  // Champs libres : une chaîne vide efface la valeur (contrairement à l'import,
  // ici l'utilisateur veut explicitement vider le champ).
  for (const key of ['civility', 'firstName', 'lastName', 'jobTitle', 'company',
    'phone', 'website', 'city', 'country'] as const) {
    if (body[key] === undefined) continue;
    const value = String(body[key] ?? '').trim();
    (data as Record<string, unknown>)[key] = value || null;
  }

  // L'email identifie le lead : il se corrige, mais sous conditions.
  if (body.email !== undefined) {
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Email invalide' }, { status: 400 });
    }
    if (email !== existing.email) {
      const taken = await prisma.lead.findUnique({ where: { email }, select: { id: true } });
      if (taken) return NextResponse.json({ error: 'Un autre lead porte déjà cette adresse' }, { status: 409 });
      data.email = email;
    }
  }

  // Répercussion sur l'affaire liée : jamais en silence. Tant que l'écran n'a
  // pas tranché, on refuse en décrivant ce qui serait modifié de l'autre côté.
  //
  // Deux réponses possibles ensuite : « both » applique des deux côtés,
  // « side » n'enregistre que le lead et laisse l'affaire en l'état. Les deux
  // sont des décisions explicites — l'absence de choix reste un refus.
  const link = await previewLeadToDeal(params.id, body);
  const linkMode: 'both' | 'side' | null = body.linkMode === 'side'
    ? 'side'
    : (body.linkMode === 'both' || body.confirmLink === true) ? 'both' : null;

  if (link && !linkMode) {
    return NextResponse.json({ requiresConfirmation: true, link }, { status: 409 });
  }
  if (body.customFields && typeof body.customFields === 'object') {
    data.customFields = body.customFields as Prisma.InputJsonValue;
  }
  if (body.ownerId !== undefined) {
    data.owner = body.ownerId ? { connect: { id: String(body.ownerId) } } : { disconnect: true };
  }

  // Changement de statut : jalons tenus à jour et trace dans la frise.
  let statusEvent: { label: string; from: string; to: string } | null = null;
  if (body.status !== undefined && body.status !== existing.status) {
    const status = String(body.status);
    if (!isLeadStatus(status)) {
      return NextResponse.json({ error: 'Statut inconnu' }, { status: 400 });
    }
    data.status = status;
    data.statusAt = new Date();
    if (status === 'unsubscribed') data.unsubscribedAt = new Date();
    if (status === 'bounced') data.bouncedAt = new Date();
    // Repasser un désinscrit à un autre statut lève la marque : c'est une
    // réinscription explicite, décidée à la main.
    if (existing.unsubscribedAt && status !== 'unsubscribed') data.unsubscribedAt = null;

    statusEvent = {
      from: existing.status,
      to: status,
      label: `Statut : ${statusLabel(existing.status)} → ${statusLabel(status)}`,
    };
  }

  if (link && linkMode === 'both' && existing.dealId) await applyLeadToDeal(link, existing.dealId);

  const lead = await prisma.lead.update({
    where: { id: params.id },
    data: {
      ...data,
      events: statusEvent
        ? { create: { type: 'status_changed', label: statusEvent.label, userName,
            payload: { from: statusEvent.from, to: statusEvent.to } } }
        : undefined,
    },
    ...FULL_LEAD,
  });

  if (link && linkMode === 'both') {
    const applied = link.impacts.filter(impact => !impact.blocked);
    if (applied.length > 0) {
      await prisma.leadEvent.create({
        data: {
          leadId: params.id,
          type: 'updated',
          userName,
          label: `Répercuté sur ${link.target} : ${applied
            .map(impact => `${impact.label} → « ${impact.to || 'vide'} »`).join(', ')}`,
        },
      });
    }
  }

  return NextResponse.json({ lead, link });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const existing = await prisma.lead.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: 'Lead introuvable' }, { status: 404 });

  // Notes et frise partent avec le lead (onDelete: Cascade dans le schéma).
  await prisma.lead.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
