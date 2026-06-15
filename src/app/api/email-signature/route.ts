import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Signature email globale ajoutée automatiquement à tous les envois du CRM.
// Stockée dans AppSetting sous la clé « emailSignature ».
export const dynamic = 'force-dynamic';

export const EMAIL_SIGNATURE_KEY = 'emailSignature';

export async function GET() {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: EMAIL_SIGNATURE_KEY } });
    return NextResponse.json({ value: setting?.value ?? '' });
  } catch (err) {
    // Table absente (avant db-sync) : on renvoie une signature vide.
    console.error('email-signature GET error:', err);
    return NextResponse.json({ value: '' });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const value = typeof body?.value === 'string' ? body.value : '';
    await prisma.appSetting.upsert({
      where: { key: EMAIL_SIGNATURE_KEY },
      create: { key: EMAIL_SIGNATURE_KEY, value },
      update: { value },
    });
    return NextResponse.json({ ok: true, value });
  } catch (err) {
    console.error('email-signature PUT error:', err);
    return NextResponse.json({ error: 'Erreur lors de l\'enregistrement' }, { status: 500 });
  }
}
