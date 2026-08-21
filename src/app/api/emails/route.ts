import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendCrmEmail } from '@/lib/email';

// Données dynamiques (lecture DB) : jamais de cache statique du Route Handler.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { dealId, templateId, to, subject, body, attachments, from } = await req.json();
    if (!to || !subject || !body) {
      return NextResponse.json({ error: 'to, subject et body requis' }, { status: 400 });
    }

    // Envoi + signature + journalisation : cf. src/lib/email.ts (partagé avec
    // la relance « lien de paiement »).
    const log = await sendCrmEmail({ dealId, templateId, from, to, subject, body, attachments });
    return NextResponse.json(log, { status: 201 });
  } catch (err) {
    console.error('[POST /api/emails]', err);
    // Expéditeur non autorisé : erreur de saisie, pas une panne serveur.
    if (err instanceof Error && err.message.includes("Adresse d'expéditeur")) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dealId = searchParams.get('dealId');
  const where = dealId ? { dealId } : {};
  const logs = await prisma.emailLog.findMany({
    where,
    orderBy: { sentAt: 'desc' },
    include: { template: true },
  });
  return NextResponse.json(logs);
}
