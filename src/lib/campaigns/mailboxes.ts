// src/lib/campaigns/mailboxes.ts
//
// Boîtes d'envoi de l'outil Campagnes : réglages par fournisseur, test de
// connexion et transport SMTP.
//
// Choix d'architecture : l'outil parle SMTP/IMAP « nu » plutôt qu'aux API des
// fournisseurs. Une seule implémentation couvre donc Google Workspace, OVH et
// n'importe quel autre hébergeur, et une nouvelle adresse s'ajoute depuis
// l'interface — aucun redéploiement, aucune validation d'application à
// demander à Google.
//
// Côté fournisseur, la seule mise en place est le mot de passe :
//   • Google Workspace → validation en deux étapes obligatoire sur le compte,
//     puis « Mots de passe des applications » (16 caractères).
//   • OVH MX Plan      → le mot de passe de la boîte, celui du webmail.

import nodemailer, { type Transporter } from 'nodemailer';
import { ImapFlow } from 'imapflow';
import type { Mailbox } from '@prisma/client';
import { decryptSecret, tryDecryptSecret } from '@/lib/campaigns/crypto';

/** Réglages serveurs pré-remplis par fournisseur. */
export const PROVIDER_PRESETS = {
  google: {
    label: 'Google Workspace / Gmail',
    smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true,
    imapHost: 'imap.gmail.com', imapPort: 993,
    hint: "Validation en deux étapes activée, puis un « mot de passe d'application » de 16 caractères.",
  },
  ovh: {
    label: 'OVH (MX Plan)',
    smtpHost: 'ssl0.ovh.net', smtpPort: 465, smtpSecure: true,
    imapHost: 'ssl0.ovh.net', imapPort: 993,
    hint: 'Le mot de passe de la boîte, celui qui ouvre le webmail OVH.',
  },
  custom: {
    label: 'Autre (réglages manuels)',
    smtpHost: '', smtpPort: 465, smtpSecure: true,
    imapHost: '', imapPort: 993,
    hint: 'Renseignez les serveurs SMTP et IMAP de votre hébergeur.',
  },
} as const;

export type ProviderKey = keyof typeof PROVIDER_PRESETS;

export function isProviderKey(value: string): value is ProviderKey {
  return value === 'google' || value === 'ovh' || value === 'custom';
}

/** Devine le fournisseur d'après le domaine — simple confort de saisie. */
export function guessProvider(email: string): ProviderKey {
  const domain = (email.split('@')[1] || '').toLowerCase();
  if (!domain) return 'custom';
  if (domain === 'gmail.com' || domain === 'googlemail.com') return 'google';
  return 'custom';
}

/** Vue publique d'une boîte : tout sauf les secrets, qui ne sortent jamais. */
export type PublicMailbox = Omit<Mailbox, 'smtpSecret' | 'imapSecret'> & {
  /** Vrai si un mot de passe IMAP distinct est enregistré. */
  hasImapSecret: boolean;
  /** Vrai si la boîte est relevée (donc éligible à l'arrêt sur réponse). */
  imapConfigured: boolean;
};

export function toPublicMailbox(mailbox: Mailbox): PublicMailbox {
  const { smtpSecret, imapSecret, ...rest } = mailbox;
  return {
    ...rest,
    hasImapSecret: Boolean(imapSecret),
    imapConfigured: Boolean(mailbox.imapHost),
  };
}

/** Valeur `From` complète d'une boîte : « Nom <adresse> ». */
export function fromHeader(mailbox: Pick<Mailbox, 'email' | 'displayName'>): string {
  const name = (mailbox.displayName || '').trim();
  return name ? `${name} <${mailbox.email}>` : mailbox.email;
}

/** Identifiants IMAP effectifs : ceux du SMTP si aucun n'est propre à l'IMAP. */
export function imapCredentials(mailbox: Mailbox): { user: string; pass: string } | null {
  if (!mailbox.imapHost) return null;
  const user = (mailbox.imapUser || mailbox.smtpUser || mailbox.email).trim();
  const pass = tryDecryptSecret(mailbox.imapSecret) ?? tryDecryptSecret(mailbox.smtpSecret);
  if (!user || !pass) return null;
  return { user, pass };
}

/**
 * Transport SMTP d'une boîte.
 *
 * `pool: true` garde la connexion ouverte entre deux envois d'un même passage :
 * on évite de rouvrir une session TLS par email, ce que les fournisseurs
 * voient d'un mauvais œil. `maxMessages` force une reconnexion régulière,
 * certains serveurs coupant les sessions trop longues.
 */
export function createTransport(mailbox: Mailbox): Transporter {
  return nodemailer.createTransport({
    host: mailbox.smtpHost,
    port: mailbox.smtpPort,
    secure: mailbox.smtpSecure,
    auth: { user: mailbox.smtpUser || mailbox.email, pass: decryptSecret(mailbox.smtpSecret) },
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

export type ConnectionCheck = { ok: boolean; error?: string };
export type MailboxCheck = { smtp: ConnectionCheck; imap: ConnectionCheck | null };

/** Message d'erreur lisible pour l'utilisateur, à partir d'une exception. */
function readableError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // Les causes les plus fréquentes, traduites une bonne fois pour toutes.
  if (/invalid login|authentication failed|AUTHENTICATIONFAILED|535/i.test(message)) {
    return "Identifiants refusés. Chez Google, il faut un « mot de passe d'application » "
      + '(la validation en deux étapes doit être active) ; chez OVH, le mot de passe du webmail.';
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return 'Serveur introuvable : vérifiez le nom du serveur.';
  if (/ETIMEDOUT|timeout/i.test(message)) return 'Délai dépassé : serveur ou port injoignable.';
  if (/ECONNREFUSED/i.test(message)) return 'Connexion refusée : vérifiez le port.';
  if (/wrong version number|SSL routines/i.test(message)) {
    return 'Négociation TLS échouée : port 465 avec TLS, ou port 587 sans TLS implicite.';
  }
  return message.slice(0, 300);
}

/** Teste le SMTP (et l'IMAP s'il est renseigné) d'une boîte. */
export async function checkMailbox(mailbox: Mailbox): Promise<MailboxCheck> {
  const result: MailboxCheck = { smtp: { ok: false }, imap: null };

  // SMTP : `verify()` ouvre la session et s'authentifie, sans rien envoyer.
  let transport: Transporter | null = null;
  try {
    transport = createTransport(mailbox);
    await transport.verify();
    result.smtp = { ok: true };
  } catch (err) {
    result.smtp = { ok: false, error: readableError(err) };
  } finally {
    transport?.close();
  }

  // IMAP : simple connexion authentifiée, puis déconnexion propre.
  const creds = imapCredentials(mailbox);
  if (mailbox.imapHost) {
    if (!creds) {
      result.imap = { ok: false, error: 'Mot de passe IMAP illisible ou absent.' };
    } else {
      const client = new ImapFlow({
        host: mailbox.imapHost,
        port: mailbox.imapPort,
        secure: true,
        auth: creds,
        logger: false,
      });
      try {
        await client.connect();
        // Ouvre le dossier surveillé : une faute de frappe se voit ici.
        const lock = await client.getMailboxLock(mailbox.imapFolder || 'INBOX');
        lock.release();
        result.imap = { ok: true };
      } catch (err) {
        result.imap = { ok: false, error: readableError(err) };
      } finally {
        try { await client.logout(); } catch { /* connexion déjà tombée */ }
      }
    }
  }

  return result;
}

/** Résumé d'un test, tel qu'on le range dans `lastError`. */
export function checkSummary(check: MailboxCheck): { ok: boolean; error: string | null } {
  const problems: string[] = [];
  if (!check.smtp.ok) problems.push(`SMTP : ${check.smtp.error || 'échec'}`);
  if (check.imap && !check.imap.ok) problems.push(`IMAP : ${check.imap.error || 'échec'}`);
  // L'envoi reste possible sans IMAP : seul un SMTP en panne rend la boîte
  // inutilisable. L'erreur IMAP est enregistrée mais ne condamne pas la boîte.
  return { ok: check.smtp.ok, error: problems.length ? problems.join(' · ') : null };
}

// ─── Normalisation des réglages saisis ────────────────────────────────────

/**
 * Mot de passe nettoyé avant chiffrement.
 *
 * Google affiche ses mots de passe d'application en quatre blocs de quatre
 * (« abcd efgh ijkl mnop ») : recopiés tels quels, les espaces partent dans la
 * commande d'authentification et le serveur refuse la connexion. On les retire
 * pour Google uniquement — ailleurs, un espace peut faire partie du mot de
 * passe et on n'y touche pas (hors espaces de début et de fin).
 */
export function normalizeSecret(password: string, provider: string): string {
  const trimmed = (password || '').trim();
  return provider === 'google' ? trimmed.replace(/\s+/g, '') : trimmed;
}

/** Entier borné, avec repli : une saisie hasardeuse reste sans conséquence. */
export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Jours d'envoi « 1,2,3,4,5 » : entiers ISO valides, dédoublonnés et triés. */
export function normalizeDays(value: unknown): string {
  const days = String(value ?? '1,2,3,4,5')
    .split(/[,;\s]+/)
    .map(Number)
    .filter(d => Number.isInteger(d) && d >= 1 && d <= 7);
  const unique = Array.from(new Set(days)).sort((a, b) => a - b);
  return (unique.length ? unique : [1, 2, 3, 4, 5]).join(',');
}
