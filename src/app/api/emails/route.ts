import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Resend } from 'resend';
import { EMAIL_SIGNATURE_KEY } from '@/lib/appSettings';
import { resolveSender } from '@/lib/emailSenders';

// Données dynamiques (lecture DB) : jamais de cache statique du Route Handler.
export const dynamic = 'force-dynamic';

/** Signature globale (HTML), ou '' si non configurée / table absente. */
async function getEmailSignature(): Promise<string> {
  try {
    const s = await prisma.appSetting.findUnique({ where: { key: EMAIL_SIGNATURE_KEY } });
    return s?.value?.trim() ? s.value : '';
  } catch {
    return '';
  }
}

/** Met le corps en HTML (ancien texte simple : \n -> <br>). */
function toHtml(s: string): string {
  return /<[a-z][\s\S]*>/i.test(s) ? s : s.replace(/\n/g, '<br>');
}

export async function POST(req: NextRequest) {
  try {
    const { dealId, templateId, to, subject, body, attachments, from } = await req.json();
    if (!to || !subject || !body) {
      return NextResponse.json({ error: 'to, subject et body requis' }, { status: 400 });
    }

    // Adresse d'expéditeur : par défaut SMTP_FROM (env). Si le client précise un
    // `from`, il doit correspondre à une adresse @swipelink.fr autorisée
    // (EMAIL_SENDERS) — sinon on refuse pour ne jamais envoyer depuis une adresse
    // arbitraire.
    let fromAddress = process.env.SMTP_FROM as string;
    if (from) {
      const resolved = resolveSender(from);
      if (!resolved) {
        return NextResponse.json({ error: "Adresse d'expéditeur non autorisée" }, { status: 400 });
      }
      fromAddress = resolved;
    }

    // Signature ajoutée automatiquement à la fin de chaque email du CRM.
    const signature = await getEmailSignature();
    const finalBody = signature ? `${toHtml(body)}<br><br>${toHtml(signature)}` : toHtml(body);

    // Instanciation paresseuse : évite de planter au chargement du module quand
    // la clé API est absente (build sans variables d'environnement).
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to,
      subject,
      html: finalBody,
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
        // On journalise le corps réellement envoyé (signature incluse).
        body: finalBody,
        status: 'sent',
        resendId: data?.id || null,
      },
    });

    return NextResponse.json(log, { status: 201 });
  } catch (err) {
    console.error('[POST /api/emails]', err);
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
