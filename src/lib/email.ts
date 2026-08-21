// src/lib/email.ts
// Envoi d'un email du CRM (Resend) + journalisation dans EmailLog.
//
// Extrait de /api/emails pour être partagé avec les envois qui ne viennent pas
// de la fiche affaire — aujourd'hui la relance « lien de paiement » validée
// dans la pop-up du matin (cf. src/lib/paymentFollowUp.ts). Un seul chemin
// d'envoi = une seule règle de signature, un seul format de journal.
import { Resend } from 'resend';
import { prisma } from '@/lib/prisma';
import { EMAIL_SIGNATURE_KEY, signatureKeyForSender } from '@/lib/appSettings';
import { resolveSender } from '@/lib/emailSenders';

/**
 * Signature (HTML) à ajouter à l'email. On privilégie la signature propre à
 * l'expéditeur (`senderEmail`) ; à défaut, on retombe sur la signature globale.
 * Retourne '' si aucune n'est configurée / table absente.
 */
export async function getEmailSignature(senderEmail?: string | null): Promise<string> {
  try {
    // Ordre de priorité : signature de l'expéditeur puis signature globale.
    const keys: string[] = [];
    if (senderEmail) keys.push(signatureKeyForSender(senderEmail));
    keys.push(EMAIL_SIGNATURE_KEY);

    const settings = await prisma.appSetting.findMany({ where: { key: { in: keys } } });
    const map = new Map(settings.map(s => [s.key, s.value]));
    for (const key of keys) {
      const v = map.get(key);
      if (v?.trim()) return v;
    }
    return '';
  } catch {
    return '';
  }
}

/** Met le corps en HTML (ancien texte simple : \n -> <br>). */
export function toHtml(s: string): string {
  return /<[a-z][\s\S]*>/i.test(s) ? s : s.replace(/\n/g, '<br>');
}

export interface SendCrmEmailArgs {
  dealId: string;
  templateId?: string | null;
  /** Adresse de l'expéditeur choisi (doit être autorisée, cf. EMAIL_SENDERS). */
  from?: string | null;
  to: string;
  subject: string;
  body: string;
  attachments?: { name: string; content: string }[];
}

/**
 * Envoie l'email via Resend, signature comprise, et journalise l'envoi
 * (EmailLog) pour qu'il apparaisse dans l'historique de l'affaire.
 *
 * Lève une erreur si l'expéditeur demandé n'est pas autorisé ou si Resend
 * refuse l'envoi — l'appelant décide quoi en faire (message d'erreur, statut
 * « error » sur la relance…).
 */
export async function sendCrmEmail(args: SendCrmEmailArgs) {
  // Adresse d'expéditeur : par défaut SMTP_FROM (env). Si un `from` est précisé,
  // il doit correspondre à une adresse @swipelink.fr autorisée (EMAIL_SENDERS) —
  // sinon on refuse pour ne jamais envoyer depuis une adresse arbitraire.
  let fromAddress = process.env.SMTP_FROM as string;
  if (args.from) {
    const resolved = resolveSender(args.from);
    if (!resolved) throw new Error("Adresse d'expéditeur non autorisée");
    fromAddress = resolved;
  }

  // Signature ajoutée automatiquement à la fin de chaque email du CRM :
  // celle de l'expéditeur choisi, sinon la signature globale (repli).
  const signature = await getEmailSignature(args.from);
  const finalBody = signature ? `${toHtml(args.body)}<br><br>${toHtml(signature)}` : toHtml(args.body);

  // Instanciation paresseuse : évite de planter au chargement du module quand
  // la clé API est absente (build sans variables d'environnement).
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: fromAddress,
    to: args.to,
    subject: args.subject,
    html: finalBody,
    attachments: args.attachments?.map(a => ({
      filename: a.name,
      content: Buffer.from(a.content, 'base64'),
    })) || [],
  });

  if (error) throw new Error(error.message);

  return prisma.emailLog.create({
    data: {
      id: `email-${Date.now()}`,
      dealId: args.dealId,
      templateId: args.templateId || null,
      to: args.to,
      subject: args.subject,
      // On journalise le corps réellement envoyé (signature incluse).
      body: finalBody,
      status: 'sent',
      resendId: data?.id || null,
    },
  });
}
