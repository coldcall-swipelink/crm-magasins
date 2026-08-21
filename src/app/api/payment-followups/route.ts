// src/app/api/payment-followups/route.ts
// File des relances « lien de paiement » à valider, lue par la pop-up du matin.
//
// Réservée aux deux relecteurs (cf. PAYMENT_FOLLOWUP_REVIEWERS) : pour tout
// autre compte, la route répond `allowed: false` avec des listes vides — la
// pop-up ne s'affiche donc jamais ailleurs.
import { NextRequest, NextResponse } from 'next/server';
import { USE_MOCK_DATA } from '@/lib/mockData';
import { isFollowUpReviewer, listPaymentFollowUps } from '@/lib/paymentFollowUp';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userName = req.nextUrl.searchParams.get('userName') || '';

  if (!isFollowUpReviewer(userName)) {
    return NextResponse.json({ allowed: false, pending: [], decided: [] });
  }
  // Données fictives (preview) : aucune relance, et surtout aucun envoi.
  if (USE_MOCK_DATA) {
    return NextResponse.json({ allowed: true, pending: [], decided: [] });
  }

  try {
    const { pending, decided } = await listPaymentFollowUps();
    return NextResponse.json({ allowed: true, pending, decided });
  } catch (err) {
    // Table absente (avant db-sync) ou base injoignable : la pop-up ne doit pas
    // casser le CRM, elle reste simplement vide.
    console.error('[GET /api/payment-followups]', err);
    return NextResponse.json({ allowed: true, pending: [], decided: [] });
  }
}
