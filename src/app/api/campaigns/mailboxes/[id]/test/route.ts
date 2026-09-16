// src/app/api/campaigns/mailboxes/[id]/test/route.ts
//
//   POST /api/campaigns/mailboxes/<id>/test
//   POST /api/campaigns/mailboxes/<id>/test  { "sendTo": "moi@exemple.fr" }
//
// Rejoue la connexion SMTP et IMAP d'une boîte déjà enregistrée, et enregistre
// le diagnostic (date + erreur éventuelle) pour que l'interface montre tout de
// suite un mot de passe expiré. Avec `sendTo`, envoie en plus un vrai email de
// test — la seule façon de vérifier que les messages partent réellement.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  checkMailbox, checkSummary, createTransport, fromHeader, toPublicMailbox,
} from '@/lib/campaigns/mailboxes';
import { isValidEmail, normalizeEmail } from '@/lib/campaigns/leadFields';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const mailbox = await prisma.mailbox.findUnique({ where: { id: params.id } });
  if (!mailbox) return NextResponse.json({ error: 'Boîte introuvable' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const sendTo = normalizeEmail(body?.sendTo || '');

  const check = await checkMailbox(mailbox);
  const summary = checkSummary(check);

  let sent: { ok: boolean; error?: string } | null = null;
  if (summary.ok && sendTo) {
    if (!isValidEmail(sendTo)) {
      sent = { ok: false, error: 'Adresse de test invalide' };
    } else {
      const transport = createTransport(mailbox);
      try {
        await transport.sendMail({
          from: fromHeader(mailbox),
          to: sendTo,
          subject: `Test d'envoi — ${mailbox.email}`,
          text: `Cet email confirme que la boîte ${mailbox.email} envoie correctement depuis le CRM.`,
          html: `<p>Cet email confirme que la boîte <strong>${mailbox.email}</strong> `
            + 'envoie correctement depuis le CRM.</p>',
        });
        sent = { ok: true };
      } catch (err) {
        sent = { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : String(err) };
      } finally {
        transport.close();
      }
    }
  }

  const updated = await prisma.mailbox.update({
    where: { id: mailbox.id },
    data: { lastCheckAt: new Date(), lastCheckOk: summary.ok, lastError: summary.error },
  });

  return NextResponse.json({ check, sent, mailbox: toPublicMailbox(updated) });
}
