import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { EMAIL_SIGNATURE_KEY, signatureKeyForSender } from '@/lib/appSettings';
import { EMAIL_SENDERS, resolveSender } from '@/lib/emailSenders';

// Signatures email ajoutées automatiquement aux envois du CRM. Une signature
// par expéditeur (clé « emailSignature:<email> »), plus une signature globale
// héritée (clé « emailSignature ») qui sert de repli. Stockées dans AppSetting.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const keys = [EMAIL_SIGNATURE_KEY, ...EMAIL_SENDERS.map(s => signatureKeyForSender(s.email))];
    const settings = await prisma.appSetting.findMany({ where: { key: { in: keys } } });
    const map = new Map(settings.map(s => [s.key, s.value]));

    // Signature par expéditeur (chaîne vide si non définie).
    const signatures: Record<string, string> = {};
    for (const s of EMAIL_SENDERS) {
      signatures[s.email] = map.get(signatureKeyForSender(s.email)) ?? '';
    }

    return NextResponse.json({
      // Signature globale (repli) — conservée pour compatibilité.
      value: map.get(EMAIL_SIGNATURE_KEY) ?? '',
      signatures,
    });
  } catch (err) {
    // Table absente (avant db-sync) : on renvoie des signatures vides.
    console.error('email-signature GET error:', err);
    return NextResponse.json({ value: '', signatures: {} });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const value = typeof body?.value === 'string' ? body.value : '';
    const sender = typeof body?.sender === 'string' ? body.sender.trim() : '';

    // Sans `sender` : on écrit la signature globale (repli). Avec `sender` : il
    // doit correspondre à un expéditeur @swipelink.fr autorisé.
    let key = EMAIL_SIGNATURE_KEY;
    if (sender) {
      if (!resolveSender(sender)) {
        return NextResponse.json({ error: 'Expéditeur non autorisé' }, { status: 400 });
      }
      key = signatureKeyForSender(sender);
    }

    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    return NextResponse.json({ ok: true, sender: sender || null, value });
  } catch (err) {
    console.error('email-signature PUT error:', err);
    return NextResponse.json({ error: 'Erreur lors de l\'enregistrement' }, { status: 500 });
  }
}
