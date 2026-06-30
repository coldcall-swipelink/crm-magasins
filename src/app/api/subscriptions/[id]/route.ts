import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recomputeDealFromSubscriptions, computeSubscriptionEnd } from '@/lib/subscriptions';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const data: Record<string, unknown> = {};

  if ('value' in body) data.value = body.value === null || body.value === '' ? null : Number(body.value);
  if ('subscriptionType' in body) data.subscriptionType = String(body.subscriptionType);
  if ('paymentMode' in body) data.paymentMode = body.paymentMode === 'virement' ? 'virement' : 'stripe';
  if ('paymentTiming' in body) data.paymentTiming = body.paymentTiming === 'mensuel' ? 'mensuel' : 'comptant';

  const closingProvided = 'closingDate' in body;
  const monthsProvided = 'subscriptionMonths' in body;
  const newClosing = closingProvided ? (body.closingDate ? new Date(body.closingDate) : null) : undefined;
  const newMonths = monthsProvided ? Number(body.subscriptionMonths) : undefined;
  if (closingProvided) data.closingDate = newClosing ?? null;
  if (monthsProvided) data.subscriptionMonths = newMonths;

  // Recalcule la date de fin si la date de closing ou la durée change.
  if (closingProvided || monthsProvided) {
    const existing = await prisma.subscription.findUnique({
      where: { id: params.id },
      select: { closingDate: true, subscriptionMonths: true },
    });
    const closing = closingProvided ? (newClosing ?? null) : (existing?.closingDate ?? null);
    const months = monthsProvided ? (newMonths ?? 12) : (existing?.subscriptionMonths ?? 12);
    data.subscriptionEndDate = computeSubscriptionEnd(closing, months);
  }

  const sub = await prisma.subscription.update({ where: { id: params.id }, data });
  await recomputeDealFromSubscriptions(sub.dealId);
  return NextResponse.json(sub);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const sub = await prisma.subscription.delete({ where: { id: params.id } });
  // Renumérote les positions restantes (0, 1).
  const rest = await prisma.subscription.findMany({ where: { dealId: sub.dealId }, orderBy: { position: 'asc' } });
  await Promise.all(rest.map((s, i) => prisma.subscription.update({ where: { id: s.id }, data: { position: i } })));
  await recomputeDealFromSubscriptions(sub.dealId);
  return NextResponse.json({ success: true });
}
