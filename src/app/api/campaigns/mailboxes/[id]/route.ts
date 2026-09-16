// src/app/api/campaigns/mailboxes/[id]/route.ts
//
//   PATCH  /api/campaigns/mailboxes/<id>  → modifie une boîte
//   DELETE /api/campaigns/mailboxes/<id>  → la supprime
//
// Le mot de passe n'est réécrit que s'il est fourni : l'interface ne le
// connaît pas (il ne sort jamais de la base), elle envoie donc un champ vide
// tant que l'utilisateur ne veut pas le changer.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encryptSecret, isEncryptionConfigured, MISSING_KEY_MESSAGE } from '@/lib/campaigns/crypto';
import { toPublicMailbox, isProviderKey, normalizeDays, normalizeSecret } from '@/lib/campaigns/mailboxes';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const existing = await prisma.mailbox.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: 'Boîte introuvable' }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });

  const data: Record<string, unknown> = {};

  const text = (key: string, field = key) => {
    if (body[key] !== undefined) data[field] = String(body[key]).trim();
  };
  const int = (key: string, min: number, max: number, field = key) => {
    if (body[key] === undefined) return;
    const n = Number(body[key]);
    if (Number.isFinite(n)) data[field] = Math.min(max, Math.max(min, Math.round(n)));
  };

  text('displayName');
  text('smtpHost');
  text('smtpUser');
  text('imapFolder');
  text('timezone');
  int('smtpPort', 1, 65535);
  int('imapPort', 1, 65535);
  int('dailyLimit', 1, 2000);
  int('minDelaySec', 0, 7200);
  int('maxDelaySec', 0, 7200);
  int('sendStartHour', 0, 23);
  int('sendEndHour', 1, 24);
  int('warmupStart', 0, 2000);
  int('warmupStep', 1, 500);

  if (body.smtpSecure !== undefined) data.smtpSecure = Boolean(body.smtpSecure);
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (body.sendDays !== undefined) data.sendDays = normalizeDays(body.sendDays);
  if (body.provider !== undefined && isProviderKey(body.provider)) data.provider = body.provider;
  if (body.signatureHtml !== undefined) {
    data.signatureHtml = body.signatureHtml ? String(body.signatureHtml) : null;
  }
  if (body.imapHost !== undefined) {
    const host = String(body.imapHost).trim();
    data.imapHost = host || null;
    // Sans serveur IMAP, le curseur de relevé n'a plus de sens.
    if (!host) { data.imapCursor = null; data.imapValidity = null; }
  }
  if (body.imapUser !== undefined) data.imapUser = String(body.imapUser).trim() || null;

  // Mots de passe : uniquement si une nouvelle valeur est transmise.
  // Le fournisseur retenu est celui que la requête pose, sinon celui en base :
  // c'est lui qui décide du nettoyage (cf. normalizeSecret).
  const provider = (data.provider as string) || existing.provider;
  for (const [key, field] of [['password', 'smtpSecret'], ['imapPassword', 'imapSecret']] as const) {
    if (!body[key]) continue;
    if (!isEncryptionConfigured()) {
      return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 503 });
    }
    data[field] = encryptSecret(normalizeSecret(String(body[key]), provider));
    // Nouveau mot de passe : l'ancien diagnostic ne vaut plus rien.
    data.lastCheckOk = null;
    data.lastError = null;
  }

  // Cohérence des bornes de délai, quelle que soit la combinaison envoyée.
  const min = (data.minDelaySec as number) ?? existing.minDelaySec;
  const max = (data.maxDelaySec as number) ?? existing.maxDelaySec;
  if (max < min) data.maxDelaySec = min;

  const mailbox = await prisma.mailbox.update({ where: { id: params.id }, data });
  return NextResponse.json({ mailbox: toPublicMailbox(mailbox) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const existing = await prisma.mailbox.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: 'Boîte introuvable' }, { status: 404 });

  await prisma.mailbox.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
