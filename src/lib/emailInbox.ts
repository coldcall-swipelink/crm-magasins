// src/lib/emailInbox.ts
//
// Relevé IMAP des boîtes @swipelink.fr (OVH MX Plan) pour récupérer les
// RÉPONSES des contacts.
//
// Pourquoi IMAP plutôt que le webhook Resend Inbound : le relevé voit tout ce
// qui arrive réellement dans la boîte — réponse à un email du CRM, mais aussi
// mail neuf, réponse à un vieux fil, ou clic sur l'adresse d'une signature.
// Le webhook, lui, ne voit que ce qui transite par l'adresse taguée du CRM.
//
// Fonctionnement : à chaque passage on lit les messages arrivés depuis le
// précédent (curseur UID mémorisé dans AppSetting), on les rattache à une
// affaire (cf. src/lib/inboundEmails.ts) et on les journalise. Le relevé est
// déclenché de l'extérieur (N8N, cron de l'hébergeur) via
// POST /api/emails/sync-replies.
//
// Variables d'environnement (voir .env.example) :
//   IMAP_HOST      (défaut : ssl0.ovh.net — serveur OVH MX Plan)
//   IMAP_PORT      (défaut : 993, TLS)
//   IMAP_FOLDER    (défaut : INBOX)
//   IMAP_PASSWORD_<LABEL>  un mot de passe par expéditeur de EMAIL_SENDERS,
//                          ex. IMAP_PASSWORD_HUGO pour hugo@swipelink.fr.
// Une boîte sans mot de passe est simplement ignorée : on peut n'en activer
// qu'une pour commencer.

import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import { prisma } from '@/lib/prisma';
import { EMAIL_SENDERS } from '@/lib/emailSenders';
import { extractAddress } from '@/lib/emailReplies';
import { recordInboundEmail, type InboundEmail, type RecordOutcome } from '@/lib/inboundEmails';

const DEFAULT_HOST = 'ssl0.ovh.net';
const DEFAULT_PORT = 993;
const DEFAULT_FOLDER = 'INBOX';

// Garde-fou : nombre de messages traités par boîte et par passage. Au-delà, le
// curseur avance quand même et le reste est pris au passage suivant.
const MAX_PER_RUN = 200;

/** Une boîte à relever : adresse + mot de passe applicatif. */
interface Mailbox {
  email: string;
  label: string;
  password: string;
}

/** Clé AppSetting du curseur de relevé d'une boîte. */
function cursorKey(email: string): string {
  return `imapCursor:${email.trim().toLowerCase()}`;
}

/** Nom de la variable d'environnement portant le mot de passe d'un expéditeur. */
function passwordVar(label: string): string {
  return `IMAP_PASSWORD_${label.toUpperCase().normalize('NFD').replace(/[^A-Z0-9]/g, '')}`;
}

/** Boîtes effectivement configurées (celles dont le mot de passe est présent). */
export function configuredMailboxes(): Mailbox[] {
  return EMAIL_SENDERS.map(s => ({
    email: s.email,
    label: s.label,
    password: (process.env[passwordVar(s.label)] || '').trim(),
  })).filter(m => m.password.length > 0);
}

/** Vrai si au moins une boîte est configurée. */
export function isImapConfigured(): boolean {
  return configuredMailboxes().length > 0;
}

/** Curseur mémorisé : validité UID de la boîte + dernier UID traité. */
interface Cursor {
  uidValidity: string;
  lastUid: number;
}

async function readCursor(email: string): Promise<Cursor | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: cursorKey(email) } });
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as Cursor;
    if (typeof parsed.uidValidity === 'string' && typeof parsed.lastUid === 'number') return parsed;
    return null;
  } catch {
    return null;
  }
}

async function writeCursor(email: string, cursor: Cursor): Promise<void> {
  const key = cursorKey(email);
  const value = JSON.stringify(cursor);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/** Adresses d'un champ mailparser (From / To / Cc), en texte simple. */
function addresses(field: AddressObject | AddressObject[] | undefined): string[] {
  if (!field) return [];
  const list = Array.isArray(field) ? field : [field];
  return list.flatMap(a => (a.value || []).map(v => v.address || '').filter(Boolean));
}

/** Corps prêt à afficher : HTML si disponible, sinon le texte converti. */
function bodyOf(parsed: ParsedMail): string {
  if (parsed.html) return parsed.html;
  if (parsed.textAsHtml) return parsed.textAsHtml;
  return parsed.text || '';
}

/** Vrai si le message vient d'une de nos propres adresses (copie d'un envoi). */
function isOwnMessage(from: string): boolean {
  const address = extractAddress(from).toLowerCase();
  return EMAIL_SENDERS.some(s => s.email.toLowerCase() === address);
}

/** Compte-rendu du relevé d'une boîte. */
export interface MailboxReport {
  mailbox: string;
  /** Messages lus sur le serveur. */
  scanned: number;
  /** Réponses journalisées dans une affaire. */
  recorded: number;
  /** Réponses déjà connues (relevé rejoué, ou déjà vues par le webhook). */
  duplicates: number;
  /** Messages ne correspondant à aucune affaire — ignorés. */
  unmatched: number;
  /** Premier relevé : le curseur est posé sans rien importer. */
  initialized?: boolean;
  error?: string;
}

/**
 * Relève une boîte et journalise les réponses trouvées.
 *
 * `sinceDays` force la reprise des messages des N derniers jours au lieu de
 * partir du curseur — utile pour un rattrapage ponctuel. La déduplication par
 * Message-ID évite les doublons.
 */
async function syncMailbox(mailbox: Mailbox, sinceDays?: number): Promise<MailboxReport> {
  const report: MailboxReport = {
    mailbox: mailbox.email, scanned: 0, recorded: 0, duplicates: 0, unmatched: 0,
  };

  const client = new ImapFlow({
    host: process.env.IMAP_HOST || DEFAULT_HOST,
    port: Number(process.env.IMAP_PORT || DEFAULT_PORT),
    secure: true,
    auth: { user: mailbox.email, pass: mailbox.password },
    // Le logger par défaut d'ImapFlow est très bavard (une ligne par commande).
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock(process.env.IMAP_FOLDER || DEFAULT_FOLDER);
  try {
    const box = client.mailbox;
    if (!box || typeof box === 'boolean') throw new Error('Dossier IMAP inaccessible');
    const uidValidity = String(box.uidValidity);
    const cursor = await readCursor(mailbox.email);

    // Sélection des messages à lire.
    let uids: number[];
    if (sinceDays && sinceDays > 0) {
      // Rattrapage explicite : tout ce qui est arrivé depuis N jours.
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      uids = await client.search({ since }, { uid: true }) || [];
    } else if (!cursor || cursor.uidValidity !== uidValidity) {
      // Premier relevé (ou boîte recréée côté serveur : la validité UID a
      // changé, les anciens UID ne veulent plus rien dire). On pose le curseur
      // sur l'état courant SANS rien importer : sinon tout l'historique de la
      // boîte remonterait d'un coup dans les affaires. Un rattrapage volontaire
      // reste possible avec sinceDays.
      const lastUid = Math.max(0, Number(box.uidNext) - 1);
      await writeCursor(mailbox.email, { uidValidity, lastUid });
      report.initialized = true;
      return report;
    } else {
      const found = await client.search({ uid: `${cursor.lastUid + 1}:*` }, { uid: true }) || [];
      // En IMAP, la plage « X:* » renvoie toujours au moins le dernier message
      // de la boîte, même si son UID est inférieur à X : on refiltre.
      uids = found.filter(uid => uid > cursor.lastUid);
    }

    uids.sort((a, b) => a - b);
    const batch = uids.slice(0, MAX_PER_RUN);
    let highestUid = cursor && cursor.uidValidity === uidValidity ? cursor.lastUid : 0;

    if (batch.length > 0) {
      for await (const message of client.fetch(batch, { uid: true, source: true }, { uid: true })) {
        report.scanned++;
        if (message.uid > highestUid) highestUid = message.uid;
        if (!message.source) continue;

        const parsed = await simpleParser(message.source);
        const from = addresses(parsed.from)[0] || '';
        // Les copies de nos propres envois ne sont pas des réponses.
        if (!from || isOwnMessage(from)) continue;

        const email: InboundEmail = {
          from,
          to: addresses(parsed.to),
          cc: addresses(parsed.cc),
          subject: parsed.subject || '',
          body: bodyOf(parsed),
          receivedAt: parsed.date || new Date(),
          messageId: parsed.messageId || null,
          inReplyTo: parsed.inReplyTo || null,
          references: Array.isArray(parsed.references)
            ? parsed.references
            : parsed.references
            ? [parsed.references]
            : [],
        };

        const outcome: RecordOutcome = await recordInboundEmail(email);
        if (outcome === 'created') report.recorded++;
        else if (outcome === 'duplicate') report.duplicates++;
        else report.unmatched++;
      }
    }

    // Le curseur n'avance que sur un relevé incrémental : un rattrapage
    // (sinceDays) relit du passé et ne doit pas déplacer le point de reprise.
    if (!sinceDays && highestUid > 0) {
      await writeCursor(mailbox.email, { uidValidity, lastUid: highestUid });
    }
  } finally {
    lock.release();
    await client.logout().catch(() => client.close());
  }

  return report;
}

/**
 * Relève toutes les boîtes configurées. Une boîte en erreur (identifiants,
 * réseau) n'interrompt pas les autres : l'erreur est remontée dans son rapport.
 */
export async function syncAllMailboxes(sinceDays?: number): Promise<MailboxReport[]> {
  const mailboxes = configuredMailboxes();
  const reports: MailboxReport[] = [];
  for (const mailbox of mailboxes) {
    try {
      reports.push(await syncMailbox(mailbox, sinceDays));
    } catch (e) {
      console.error(`[IMAP] relevé de ${mailbox.email} impossible`, e);
      reports.push({
        mailbox: mailbox.email, scanned: 0, recorded: 0, duplicates: 0, unmatched: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return reports;
}
