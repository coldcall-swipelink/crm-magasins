// src/app/api/campaigns/repair-bounces/route.ts
//
//   GET  /api/campaigns/repair-bounces?token=…           → bilan, sans rien changer
//   POST /api/campaigns/repair-bounces?token=…&apply=1   → réparation effective
//
// Répare les leads marqués « adresse morte » À TORT.
//
// Pourquoi cette route existe : le moteur a longtemps considéré tout code
// « 5.x.x » comme un rejet définitif du destinataire. Or « 535-5.7.8 Username
// and Password not accepted » (authentification refusée) et « 5.7.0 Daily
// sending quota exceeded » (quota atteint) sont des problèmes de la BOÎTE
// D'ENVOI. Une boîte mal configurée condamnait donc les leads qu'elle visait,
// un par un, alors que leurs adresses étaient parfaitement valides.
//
// Le défaut est corrigé dans le moteur ; cette route rattrape les leads déjà
// touchés. Elle est rejouable et ne touche qu'aux leads dont l'échec vient
// bien de l'expéditeur : un vrai rejet d'adresse reste un rejet.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { classifyFailure } from '@/lib/campaigns/engine';
import { nextOpenSlot } from '@/lib/campaigns/schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function unauthorized(req: NextRequest): boolean {
  const provided = (req.nextUrl.searchParams.get('token')
    || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || '').trim();
  if (!provided) return true;
  const accepted = [process.env.CRON_SECRET, process.env.EMAIL_SYNC_TOKEN, process.env.OFFERS_WEBHOOK_TOKEN]
    .map(value => (value || '').trim())
    .filter(Boolean);
  return !accepted.includes(provided);
}

async function run(req: NextRequest, apply: boolean) {
  if (unauthorized(req)) return NextResponse.json({ error: 'Token invalide' }, { status: 401 });

  // Tous les échecs d'envoi enregistrés, avec leur message d'erreur.
  const failures = await prisma.campaignMessage.findMany({
    where: { status: 'failed', error: { not: null } },
    select: { id: true, leadId: true, error: true, mailboxId: true, sentAt: true },
    orderBy: { sentAt: 'desc' },
    take: 5000,
  });

  // On ne retient que ceux dont la faute revient à l'expéditeur.
  const wronglyBlamed = new Map<string, string>();   // leadId → motif constaté
  for (const failure of failures) {
    const reason = failure.error || '';
    if (classifyFailure(undefined, reason) === 'mailbox') {
      if (!wronglyBlamed.has(failure.leadId)) wronglyBlamed.set(failure.leadId, reason.slice(0, 200));
    }
  }

  const leadIds = Array.from(wronglyBlamed.keys());
  if (leadIds.length === 0) {
    return NextResponse.json({ ok: true, applied: apply, leads: 0, message: 'Aucun lead à réparer.' });
  }

  // Seuls ceux effectivement marqués « adresse morte » sont concernés.
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds }, OR: [{ status: 'bounced' }, { bouncedAt: { not: null } }] },
    select: { id: true, email: true, status: true },
  });

  const enrollments = await prisma.campaignEnrollment.findMany({
    where: { leadId: { in: leads.map(lead => lead.id) }, status: 'stopped', stopReason: 'bounced' },
    include: { mailbox: true, campaign: { select: { name: true, status: true } } },
  });

  const report = {
    ok: true,
    applied: apply,
    leads: leads.length,
    enrollments: enrollments.length,
    details: leads.slice(0, 50).map(lead => ({
      email: lead.email,
      cause: wronglyBlamed.get(lead.id),
    })),
  };

  if (!apply) {
    return NextResponse.json({
      ...report,
      message: `${leads.length} lead(s) et ${enrollments.length} séquence(s) seraient réparés. `
        + 'Relancez en POST avec &apply=1 pour appliquer.',
    });
  }

  for (const lead of leads) {
    // Le lead retrouve un statut cohérent : « contacté » s'il a déjà reçu un
    // email, « nouveau » sinon. On ne devine pas mieux, et c'est sans risque.
    const sentCount = await prisma.campaignMessage.count({ where: { leadId: lead.id, status: 'sent' } });
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: sentCount > 0 ? 'contacted' : 'new',
        statusAt: new Date(),
        bouncedAt: null,
      },
    });
    await prisma.leadEvent.create({
      data: {
        leadId: lead.id,
        type: 'updated',
        label: "Marqué « adresse morte » à tort : l'échec venait de la boîte d'envoi, pas de l'adresse. Statut rétabli.",
        payload: { cause: wronglyBlamed.get(lead.id) },
      },
    });
  }

  for (const enrollment of enrollments) {
    await prisma.campaignEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: 'active',
        stopReason: null,
        finishedAt: null,
        // Reprise au prochain créneau ouvert de sa boîte.
        nextSendAt: enrollment.mailbox ? nextOpenSlot(enrollment.mailbox, new Date()) : new Date(),
      },
    });
  }

  return NextResponse.json({
    ...report,
    message: `${leads.length} lead(s) rétabli(s), ${enrollments.length} séquence(s) relancée(s). `
      + "Corrigez la boîte d'envoi avant le prochain passage du moteur, sinon l'échec se répétera.",
  });
}

export async function GET(req: NextRequest) { return run(req, false); }
export async function POST(req: NextRequest) {
  return run(req, req.nextUrl.searchParams.get('apply') === '1');
}
