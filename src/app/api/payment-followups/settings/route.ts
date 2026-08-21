// src/app/api/payment-followups/settings/route.ts
// Paramétrage du mail de relance « lien de paiement » (Paramètres du CRM) :
// expéditeur, sujet, corps et délai avant relance.
import { NextRequest, NextResponse } from 'next/server';
import { resolveSender } from '@/lib/emailSenders';
import {
  DEFAULT_FOLLOWUP_BODY,
  DEFAULT_FOLLOWUP_SUBJECT,
  FOLLOWUP_VARIABLES,
  getPaymentFollowUpSettings,
  savePaymentFollowUpSettings,
} from '@/lib/paymentFollowUp';

export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = await getPaymentFollowUpSettings();
  return NextResponse.json({
    ...settings,
    variables: FOLLOWUP_VARIABLES,
    defaults: { subject: DEFAULT_FOLLOWUP_SUBJECT, body: DEFAULT_FOLLOWUP_BODY },
  });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();

    // Expéditeur : uniquement une adresse @swipelink.fr autorisée, comme pour
    // tous les autres envois du CRM.
    if (typeof body?.from === 'string' && body.from && !resolveSender(body.from)) {
      return NextResponse.json({ error: 'Expéditeur non autorisé' }, { status: 400 });
    }
    const delayDays = Number(body?.delayDays);
    if (body?.delayDays !== undefined && (!Number.isFinite(delayDays) || delayDays < 1)) {
      return NextResponse.json({ error: 'Le délai doit être d\'au moins 1 jour' }, { status: 400 });
    }

    await savePaymentFollowUpSettings({
      subject:   typeof body?.subject === 'string' ? body.subject : undefined,
      body:      typeof body?.body === 'string' ? body.body : undefined,
      from:      typeof body?.from === 'string' && body.from ? body.from : undefined,
      delayDays: body?.delayDays !== undefined ? delayDays : undefined,
    });

    return NextResponse.json(await getPaymentFollowUpSettings());
  } catch (err) {
    console.error('[PUT /api/payment-followups/settings]', err);
    return NextResponse.json({ error: 'Erreur lors de l\'enregistrement' }, { status: 500 });
  }
}
