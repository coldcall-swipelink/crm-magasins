// src/app/api/campaigns/mailboxes/route.ts
//
// Boîtes d'envoi de l'outil Campagnes.
//
//   GET  /api/campaigns/mailboxes   → la liste (sans aucun mot de passe)
//   POST /api/campaigns/mailboxes   → ajoute une boîte, après test de connexion
//
// Le mot de passe saisi n'est enregistré QUE si la connexion SMTP aboutit :
// une boîte présente dans la liste est donc une boîte qui a déjà fonctionné.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isEncryptionConfigured, encryptSecret, MISSING_KEY_MESSAGE } from '@/lib/campaigns/crypto';
import {
  PROVIDER_PRESETS, isProviderKey, toPublicMailbox, checkMailbox, checkSummary,
  clampInt, normalizeDays, normalizeSecret,
} from '@/lib/campaigns/mailboxes';
import { normalizeEmail, isValidEmail } from '@/lib/campaigns/leadFields';

export const dynamic = 'force-dynamic';
// Un test de connexion SMTP puis IMAP peut prendre plusieurs secondes.
export const maxDuration = 60;

export async function GET() {
  try {
    const mailboxes = await prisma.mailbox.findMany({ orderBy: { createdAt: 'asc' } });
    return NextResponse.json({
      mailboxes: mailboxes.map(toPublicMailbox),
      encryptionReady: isEncryptionConfigured(),
      // Conservés dans la réponse pour compatibilité, mais l'interface lit
      // désormais les mêmes constantes en local : la liste des fournisseurs
      // doit s'afficher même quand cet appel échoue.
      presets: PROVIDER_PRESETS,
    });
  } catch (err) {
    // Cas de loin le plus fréquent : la table n'existe pas encore, parce que le
    // schéma n'a pas été propagé après le déploiement. On le dit, plutôt que de
    // laisser l'écran vide sans explication.
    const message = err instanceof Error ? err.message : String(err);
    const missingTable = /does not exist|P2021|relation .* does not exist/i.test(message);
    console.error('[GET /api/campaigns/mailboxes]', err);
    return NextResponse.json({
      error: missingTable
        ? 'Les tables de l\'outil Campagnes sont absentes de la base : le schéma n\'a pas été '
          + 'propagé après le déploiement (npx prisma db push, ou /api/admin/db-sync).'
        : message.slice(0, 300),
    }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!isEncryptionConfigured()) {
    return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });

  const email = normalizeEmail(body.email || '');
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Adresse email invalide' }, { status: 400 });
  }
  const provider = isProviderKey(body.provider || '') ? body.provider : 'custom';

  // Nettoyage avant tout : un mot de passe d'application Google recopié avec
  // ses espaces serait refusé, sans que rien ne dise pourquoi.
  const password = normalizeSecret(String(body.password || ''), provider);
  if (!password) return NextResponse.json({ error: 'Mot de passe requis' }, { status: 400 });

  const exists = await prisma.mailbox.findUnique({ where: { email }, select: { id: true } });
  if (exists) {
    return NextResponse.json({ error: 'Cette boîte est déjà enregistrée' }, { status: 409 });
  }

  const preset = PROVIDER_PRESETS[provider as keyof typeof PROVIDER_PRESETS];

  const smtpHost = String(body.smtpHost || preset.smtpHost || '').trim();
  if (!smtpHost) return NextResponse.json({ error: 'Serveur SMTP requis' }, { status: 400 });
  const imapHost = String(body.imapHost ?? preset.imapHost ?? '').trim();

  // La boîte est construite en mémoire, testée, et seulement ensuite écrite :
  // on n'enregistre jamais des identifiants qui ne fonctionnent pas.
  const draft = {
    email,
    displayName: String(body.displayName || '').trim(),
    provider,
    smtpHost,
    smtpPort: Number(body.smtpPort) || preset.smtpPort,
    smtpSecure: body.smtpSecure !== undefined ? Boolean(body.smtpSecure) : preset.smtpSecure,
    smtpUser: String(body.smtpUser || email).trim(),
    smtpSecret: encryptSecret(password),
    imapHost: imapHost || null,
    imapPort: Number(body.imapPort) || preset.imapPort,
    imapUser: String(body.imapUser || email).trim(),
    // Mot de passe IMAP distinct seulement s'il est explicitement fourni :
    // sinon celui du SMTP est réutilisé (cf. imapCredentials).
    imapSecret: body.imapPassword ? encryptSecret(normalizeSecret(String(body.imapPassword), provider)) : null,
    imapFolder: String(body.imapFolder || 'INBOX').trim() || 'INBOX',
    ...numericSettings(body),
    signatureHtml: body.signatureHtml ? String(body.signatureHtml) : null,
  };

  const check = await checkMailbox({
    ...draft,
    id: 'draft', imapCursor: null, imapValidity: null, active: true, nextSendAt: null,
    lastCheckAt: null, lastCheckOk: null, lastError: null, lastSyncAt: null,
    warmupStartedAt: null, createdAt: new Date(), updatedAt: new Date(),
  });
  const summary = checkSummary(check);
  if (!summary.ok) {
    // 422 : la requête est bien formée, ce sont les identifiants qui ne passent pas.
    return NextResponse.json({ error: summary.error, check }, { status: 422 });
  }

  const mailbox = await prisma.mailbox.create({
    data: {
      ...draft,
      lastCheckAt: new Date(),
      lastCheckOk: true,
      lastError: summary.error,   // ex. « IMAP : … » quand seul l'IMAP a échoué
    },
  });

  return NextResponse.json({ mailbox: toPublicMailbox(mailbox), check }, { status: 201 });
}

/** Garde-fous d'envoi, bornés pour qu'une saisie hasardeuse reste sans danger. */
function numericSettings(body: Record<string, unknown>) {
  const minDelaySec = clampInt(body.minDelaySec, 90, 0, 7200);
  const maxDelaySec = clampInt(body.maxDelaySec, 300, 0, 7200);
  return {
    dailyLimit:    clampInt(body.dailyLimit, 80, 1, 2000),
    minDelaySec,
    // La borne haute ne peut pas passer sous la borne basse.
    maxDelaySec:   Math.max(minDelaySec, maxDelaySec),
    sendStartHour: clampInt(body.sendStartHour, 8, 0, 23),
    sendEndHour:   clampInt(body.sendEndHour, 19, 1, 24),
    sendDays:      normalizeDays(body.sendDays),
    timezone:      String(body.timezone || 'Europe/Paris'),
    warmupStart:   clampInt(body.warmupStart, 0, 0, 2000),
    warmupStep:    clampInt(body.warmupStep, 5, 1, 500),
  };
}
