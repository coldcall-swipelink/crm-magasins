import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Resend } from 'resend';
import { DEMO_MODE, demoEmails } from '@/lib/demo';

export async function POST(req: NextRequest) {
  try {
    const { dealId, templateId, to, subject, body, attachments } = await req.json();
    if (!to || !subject || !body) {
      return NextResponse.json({ error: 'to, subject et body requis' }, { status: 400 });
    }

    // Instanciation paresseuse : évite de planter au chargement du module quand
    // la clé API est absente (preview / build sans variables d'environnement).
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: process.env.SMTP_FROM as string,
      to,
      subject,
      html: body.replace(/\n/g, '<br>'),
      attachments: attachments?.map((a: { name: string; content: string }) => ({
        filename: a.name,
        content: Buffer.from(a.content, 'base64'),
      })) || [],
    });

    if (error) throw new Error(error.message);

    const log = await prisma.emailLog.create({
      data: {
        id: `email-${Date.now()}`,
        dealId,
        templateId: templateId || null,
        to,
        subject,
        body,
        status: 'sent',
        resendId: data?.id || null,
      },
    });

    return NextResponse.json(log, { status: 201 });
  } catch (err) {
    if (DEMO_MODE) {
      // Mode démo : on simule un envoi réussi sans persistance ni envoi réel.
      return NextResponse.json({ id: `demo-${Date.now()}`, status: 'sent', demo: true }, { status: 201 });
    }
    console.error('[POST /api/emails]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dealId = searchParams.get('dealId');
  try {
    const where = dealId ? { dealId } : {};
    const logs = await prisma.emailLog.findMany({
      where,
      orderBy: { sentAt: 'desc' },
      include: { template: true },
    });
    return NextResponse.json(logs);
  } catch (err) {
    if (DEMO_MODE) return NextResponse.json(demoEmails(dealId || 'deal-1'));
    throw err;
  }
}
