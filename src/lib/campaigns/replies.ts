// src/lib/campaigns/replies.ts
//
// Relevé IMAP des boîtes d'envoi : c'est ce qui fait marcher l'arrêt
// automatique « le lead a répondu, on ne le relance plus ».
//
// Pourquoi l'IMAP plutôt qu'un webhook : les emails partent d'une vraie boîte,
// les réponses y arrivent donc directement. On lit la boîte, exactement comme
// le relevé déjà en place pour les affaires (src/lib/emailInbox.ts) — à ceci
// près que les identifiants viennent de la base et non de l'environnement.
//
// Rattachement d'une réponse, du plus sûr au plus tolérant :
//   1. l'en-tête In-Reply-To / References pointe sur le Message-ID d'un de nos
//      envois → aucune ambiguïté ;
//   2. à défaut, l'adresse de l'expéditeur correspond à un lead ayant une
//      inscription active sur cette boîte.
//
// Un message sans correspondance est ignoré : la boîte reçoit aussi du
// courrier qui n'a rien à voir avec les campagnes.

import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import type { Mailbox } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { clearBouncedOpen } from '@/lib/campaigns/bounceCleanup';
import { imapCredentials } from '@/lib/campaigns/mailboxes';
import { normalizeEmail } from '@/lib/campaigns/leadFields';
import { identityKey } from '@/lib/campaigns/emailIdentity';

/** Messages lus par boîte et par passage : le reste attend le suivant. */
const MAX_PER_RUN = 200;

export type MailboxSyncReport = {
  mailbox: string;
  scanned: number;
  replies: number;
  bounces: number;
  stopped: number;
  unmatched: number;
  initialized?: boolean;
  error?: string;
};

export type SyncResult = { reports: MailboxSyncReport[] };

/** Adresses d'un champ mailparser (From / To), en texte simple. */
function addresses(field: AddressObject | AddressObject[] | undefined): string[] {
  if (!field) return [];
  const list = Array.isArray(field) ? field : [field];
  return list.flatMap(item => (item.value || []).map(value => value.address || '').filter(Boolean));
}

/**
 * Le lead derrière une réponse, quand les en-têtes ne l'ont pas donné.
 *
 *   1. l'adresse d'envoi, à la lettre — le cas ordinaire ;
 *   2. une adresse connue en copie : l'interlocuteur répond d'une autre
 *      adresse mais garde celle qu'on lui a écrite en copie ;
 *   3. la même identité à l'extension près (« @socamaine.leclerc » pour
 *      « @socamaine.fr »), et SEULEMENT si elle ne désigne qu'un lead —
 *      attribuer la réponse au mauvais contact serait pire que de ne rien
 *      conclure.
 */
async function findLead(from: string, recipients: string[]) {
  const exact = await prisma.lead.findUnique({ where: { email: from } });
  if (exact) return exact;

  if (recipients.length > 0) {
    const inCopy = await prisma.lead.findFirst({ where: { email: { in: recipients } } });
    if (inCopy) return inCopy;
  }

  const key = identityKey(from);
  if (!key) return null;

  // La clé n'est pas stockée : on ramène les leads de la même partie locale,
  // puis on compare les clés en mémoire. La partie locale est discriminante,
  // donc le lot reste petit.
  const local = from.slice(0, from.lastIndexOf('@'));
  const sameLocal = await prisma.lead.findMany({
    where: { email: { startsWith: `${local}@`, mode: 'insensitive' } },
    take: 25,
  });
  const matches = sameLocal.filter(lead => identityKey(lead.email) === key);
  return matches.length === 1 ? matches[0] : null;
}

/** Message-ID cités par une réponse, du plus proche au plus lointain. */
function referencedIds(inReplyTo?: string, references?: string | string[]): string[] {
  const raw = [inReplyTo || '', ...(Array.isArray(references) ? references : [references || ''])].join(' ');
  return Array.from(raw.matchAll(/<[^>]+>/g)).map(match => match[0]).reverse();
}

/** Relève toutes les boîtes actives dotées d'un accès IMAP. */
export async function syncAllReplies(sinceDays?: number): Promise<SyncResult> {
  const mailboxes = await prisma.mailbox.findMany({
    where: { active: true, imapHost: { not: null } },
  });

  const reports: MailboxSyncReport[] = [];
  // Séquentiel : quelques boîtes, et un relevé IMAP est surtout de l'attente
  // réseau — inutile d'ouvrir toutes les sessions en même temps.
  for (const mailbox of mailboxes) {
    reports.push(await syncMailboxReplies(mailbox, sinceDays));
  }
  return { reports };
}

/** Relève une boîte : lit les nouveaux messages et traite les réponses. */
export async function syncMailboxReplies(mailbox: Mailbox, sinceDays?: number): Promise<MailboxSyncReport> {
  const report: MailboxSyncReport = {
    mailbox: mailbox.email, scanned: 0, replies: 0, bounces: 0, stopped: 0, unmatched: 0,
  };

  const credentials = imapCredentials(mailbox);
  if (!credentials) {
    report.error = 'Identifiants IMAP illisibles';
    return report;
  }

  const client = new ImapFlow({
    host: mailbox.imapHost!,
    port: mailbox.imapPort,
    secure: true,
    auth: credentials,
    logger: false,   // le journal par défaut écrit une ligne par commande IMAP
  });

  try {
    await client.connect();
  } catch (err) {
    report.error = err instanceof Error ? err.message.slice(0, 200) : String(err);
    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: { lastSyncAt: new Date(), lastError: `IMAP : ${report.error}` },
    });
    return report;
  }

  const lock = await client.getMailboxLock(mailbox.imapFolder || 'INBOX');
  try {
    const box = client.mailbox;
    if (!box || typeof box === 'boolean') throw new Error('Dossier IMAP inaccessible');

    const uidValidity = Number(box.uidValidity);
    const cursorValid = mailbox.imapValidity === uidValidity && mailbox.imapCursor !== null;

    let uids: number[];
    if (sinceDays && sinceDays > 0) {
      // Rattrapage volontaire : tout ce qui est arrivé depuis N jours.
      uids = (await client.search({ since: new Date(Date.now() - sinceDays * 86_400_000) }, { uid: true })) || [];
    } else if (!cursorValid) {
      // Premier relevé, ou boîte recréée côté serveur (la validité UID a
      // changé) : on pose le curseur sur l'état courant SANS rien traiter,
      // pour ne pas rejouer tout l'historique de la boîte.
      await prisma.mailbox.update({
        where: { id: mailbox.id },
        data: {
          imapValidity: uidValidity,
          imapCursor: Math.max(0, Number(box.uidNext) - 1),
          lastSyncAt: new Date(),
        },
      });
      report.initialized = true;
      return report;
    } else {
      const found = (await client.search({ uid: `${mailbox.imapCursor! + 1}:*` }, { uid: true })) || [];
      // « X:* » renvoie toujours au moins le dernier message de la boîte, même
      // si son UID est inférieur à X : on refiltre.
      uids = found.filter(uid => uid > mailbox.imapCursor!);
    }

    uids.sort((a, b) => a - b);
    const batch = uids.slice(0, MAX_PER_RUN);
    let highestUid = cursorValid ? mailbox.imapCursor! : 0;

    for await (const message of client.fetch(batch, { uid: true, source: true }, { uid: true })) {
      report.scanned++;
      if (message.uid > highestUid) highestUid = message.uid;
      if (!message.source) continue;

      try {
        await handleMessage(mailbox, await simpleParser(message.source), report);
      } catch (err) {
        // Un message illisible ne doit pas interrompre le relevé.
        console.error('[campaigns/replies]', mailbox.email, err);
      }
    }

    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: {
        imapValidity: uidValidity, imapCursor: highestUid, lastSyncAt: new Date(),
        // La relève a abouti : l'erreur IMAP précédente n'a plus lieu d'être.
        // Sans cet effacement, un incident réglé depuis longtemps reste
        // affiché sur la boîte comme s'il durait encore — et on cherche une
        // panne qui n'existe plus. On ne touche pas à une erreur d'ENVOI :
        // l'IMAP qui fonctionne ne dit rien du SMTP.
        ...(mailbox.lastError && mailbox.lastError.startsWith('IMAP') ? { lastError: null } : {}),
      },
    });
  } catch (err) {
    report.error = err instanceof Error ? err.message.slice(0, 200) : String(err);
  } finally {
    lock.release();
    try { await client.logout(); } catch { /* connexion déjà tombée */ }
  }

  return report;
}

/** Traite un message reçu : réponse de lead, rejet serveur, ou rien. */
async function handleMessage(
  mailbox: Mailbox,
  parsed: Awaited<ReturnType<typeof simpleParser>>,
  report: MailboxSyncReport,
) {
  const from = normalizeEmail(addresses(parsed.from)[0] || '');
  if (!from) { report.unmatched++; return; }

  // Nos propres envois (copie dans la boîte) ne sont pas des réponses.
  const ownBox = await prisma.mailbox.findFirst({ where: { email: from }, select: { id: true } });
  if (ownBox) { report.unmatched++; return; }

  const references = referencedIds(parsed.inReplyTo, parsed.references);
  const original = references.length
    ? await prisma.campaignMessage.findFirst({
        where: { messageId: { in: references } },
        include: { enrollment: { include: { campaign: true } }, lead: true },
        orderBy: { sentAt: 'desc' },
      })
    : null;

  const bounce = /mailer-daemon|postmaster|no-?reply@/i.test(from)
    || /^(undeliverable|delivery status notification|mail delivery failed|returned mail)/i.test(parsed.subject || '');

  // ─── Rejet serveur (bounce) ─────────────────────────────────────────────
  if (bounce) {
    // Un rapport de non-remise cite le message d'origine, soit en en-tête,
    // soit dans son corps. Sans cette citation, on ne peut rien conclure.
    const target = original ?? await findMessageQuotedIn(parsed.text || '');
    if (!target) { report.unmatched++; return; }

    // Le message est marqué rejeté, et l'« ouverture » qu'il a pu enregistrer
    // est effacée : elle ne venait pas du destinataire — il n'a rien reçu —
    // mais de la lecture du rapport de non-remise, qui cite l'email d'origine
    // avec son pixel. Règle partagée avec le script de rattrapage : seule
    // l'ouverture du message rejeté saute, les précédentes sont vraies.
    await clearBouncedOpen(target.id, target.leadId)
      .catch(() => { /* le message a pu être purgé : le rejet prime */ });

    await prisma.lead.update({
      where: { id: target.leadId },
      data: { status: 'bounced', statusAt: new Date(), bouncedAt: new Date() },
    });
    await prisma.leadEvent.create({
      data: {
        leadId: target.leadId,
        type: 'bounced',
        label: `Rejet du serveur : ${(parsed.subject || '').slice(0, 140)}`,
      },
    });
    await prisma.campaignEnrollment.updateMany({
      where: { id: target.enrollmentId, status: { in: ['active', 'sending', 'paused'] } },
      data: { status: 'stopped', stopReason: 'bounced', nextSendAt: null, finishedAt: new Date() },
    });
    report.bounces++;
    report.stopped++;
    return;
  }

  // ─── Réponse d'un lead ──────────────────────────────────────────────────
  //
  // À qui appartient cette réponse ? Quatre pistes, de la plus sûre à la plus
  // souple. Elles existent parce qu'une réponse arrive souvent d'une AUTRE
  // adresse que celle qu'on a écrite — un adhérent répond de
  // « …@socamaine.leclerc » quand on a écrit à « …@socamaine.fr ».
  const recipients = [...addresses(parsed.to), ...addresses(parsed.cc)]
    .map(normalizeEmail).filter(Boolean);
  const lead = original?.lead ?? await findLead(from, recipients);
  if (!lead) { report.unmatched++; return; }

  const receivedAt = parsed.date || new Date();
  const snippet = (parsed.text || '').replace(/\s+/g, ' ').trim().slice(0, 500);

  // Déduplication : un relevé rejoué ne compte pas deux fois la même réponse.
  const messageId = parsed.messageId || null;
  if (messageId) {
    const known = await prisma.campaignReply.findUnique({
      where: { mailboxId_messageId: { mailboxId: mailbox.id, messageId } },
      select: { id: true },
    });
    if (known) return;
  }

  // Le compteur de réponses d'une campagne se lit sur les MESSAGES marqués
  // répondus : sans cette marque, une réponse bien enregistrée ne compte
  // nulle part. Quand les en-têtes ne désignent pas le message d'origine, on
  // prend le dernier email réellement parti à ce lead — c'est celui auquel il
  // répond, sauf exception. Il donne aussi sa campagne à la réponse.
  const answered = original ?? await prisma.campaignMessage.findFirst({
    where: { leadId: lead.id, status: 'sent' },
    orderBy: { sentAt: 'desc' },
    select: { id: true, campaignId: true, enrollmentId: true },
  });

  await prisma.campaignReply.create({
    data: {
      mailboxId: mailbox.id,
      leadId: lead.id,
      campaignId: answered?.campaignId ?? null,
      fromAddress: from,
      subject: (parsed.subject || '').slice(0, 300),
      snippet,
      messageId,
      inReplyTo: references[0] || null,
      receivedAt,
    },
  });
  report.replies++;

  if (answered) {
    await prisma.campaignMessage.update({
      where: { id: answered.id },
      data: { repliedAt: receivedAt },
    });
  }

  // Le statut du lead passe à « a répondu », sauf s'il porte déjà un statut
  // posé à la main qui en dit plus (intéressé, pas intéressé, client).
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      lastRepliedAt: receivedAt,
      ...(['new', 'contacted'].includes(lead.status)
        ? { status: 'replied', statusAt: receivedAt } : {}),
    },
  });
  await prisma.leadEvent.create({
    data: {
      leadId: lead.id,
      type: 'replied',
      label: `Réponse reçue : « ${(parsed.subject || 'sans objet').slice(0, 120)} »`,
      payload: { mailbox: mailbox.email, snippet: snippet.slice(0, 200) },
    },
  });

  // ─── Arrêt des séquences ────────────────────────────────────────────────
  // Précis quand on sait à quel email le lead répond : seule CETTE campagne
  // s'arrête. Sinon, toutes les séquences en cours de ce lead — un lead qui
  // répond n'a pas à recevoir la relance d'une autre campagne le lendemain.
  const stopWhere = answered
    ? { id: answered.enrollmentId, campaign: { stopOnReply: true } }
    : { leadId: lead.id, campaign: { stopOnReply: true } };

  const stopped = await prisma.campaignEnrollment.updateMany({
    where: { ...stopWhere, status: { in: ['active', 'sending', 'paused'] } },
    data: { status: 'stopped', stopReason: 'replied', nextSendAt: null, finishedAt: new Date() },
  });
  report.stopped += stopped.count;

  if (stopped.count > 0) {
    await prisma.leadEvent.create({
      data: {
        leadId: lead.id,
        type: 'stopped',
        label: stopped.count > 1
          ? `${stopped.count} séquences arrêtées (réponse du lead)`
          : 'Séquence arrêtée : le lead a répondu',
      },
    });
  }
}

/**
 * Retrouve l'envoi cité dans le corps d'un rapport de non-remise.
 * Les serveurs y recopient les en-têtes du message rejeté, Message-ID compris.
 */
async function findMessageQuotedIn(text: string) {
  const ids = Array.from(text.matchAll(/<[^>\s]+@[^>\s]+>/g)).map(match => match[0]);
  if (ids.length === 0) return null;
  return prisma.campaignMessage.findFirst({
    where: { messageId: { in: ids } },
    include: { enrollment: { include: { campaign: true } }, lead: true },
    orderBy: { sentAt: 'desc' },
  });
}
