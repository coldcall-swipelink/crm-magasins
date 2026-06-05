import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Route API dynamique : exécutée à chaque requête (lit la base de données),
// jamais pré-générée au build.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, data } = body;

    if (type === 'email.opened') {
      const emailId = data?.email_id;
      if (emailId) {
        await prisma.emailLog.updateMany({
          where: { resendId: emailId },
          data: { status: 'opened', openedAt: new Date() },
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Resend webhook]', err);
    return NextResponse.json({ error: 'Erreur' }, { status: 500 });
  }
}
