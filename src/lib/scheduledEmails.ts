// src/lib/scheduledEmails.ts
/**
 * Envois d'emails programmés (« envoyer demain à 9h »).
 *
 * Un email programmé est un EmailLog écrit en base au moment de la rédaction,
 * avec le statut « scheduled » et l'heure visée dans `scheduledAt`. Il apparaît
 * donc tout de suite dans la frise de l'affaire, et peut être annulé tant qu'il
 * n'est pas parti.
 *
 * Il part au premier passage de `sendDueEmails`, déclenché de deux façons :
 *   • par le planificateur (N8N / cron de l'hébergeur) sur
 *     POST /api/emails/send-scheduled?token=… — c'est LUI qui garantit le
 *     départ quand personne n'est devant le CRM ;
 *   • opportunément à l'ouverture d'une fiche affaire, pour que l'heure dite
 *     ne soit pas attendue quand quelqu'un travaille dans le CRM.
 *
 * Les deux chemins peuvent tourner en même temps : chaque email est donc
 * RÉSERVÉ avant envoi (« scheduled » → « sending », de façon atomique), si
 * bien qu'un email ne peut jamais partir deux fois.
 */

import { Resend } from 'resend';
import { prisma } from '@/lib/prisma';
import { buildReplyTo } from '@/lib/emailReplies';

/** Nombre d'emails traités par passage : au-delà, le passage suivant prend la
 *  suite. Évite qu'un arriéré fasse dépasser le temps d'exécution de la route. */
const LOT = 25;

export type SendDueResult = {
  due: number;
  sent: number;
  failed: number;
  errors: Array<{ id: string; message: string }>;
  /** Renseigné quand rien n'a pu être tenté (Resend non configuré). */
  blocked?: string;
};

/**
 * Envoie les emails programmés dont l'heure est passée.
 * Tolérant : un email en échec est marqué « failed » et n'empêche pas les autres.
 */
export async function sendDueEmails(now: Date = new Date()): Promise<SendDueResult> {
  const due = await prisma.emailLog.findMany({
    where: { status: 'scheduled', scheduledAt: { lte: now } },
    orderBy: { scheduledAt: 'asc' },
    take: LOT,
    select: {
      id: true, dealId: true, fromAddress: true, to: true, cc: true,
      subject: true, body: true,
    },
  });

  const result: SendDueResult = { due: due.length, sent: 0, failed: 0, errors: [] };
  if (due.length === 0) return result;

  // Clé absente : on ne touche PAS à la file. La marquer en échec la viderait
  // pour une erreur de configuration, alors que ces emails doivent partir dès
  // que la clé est remise. Le planificateur, lui, verra l'anomalie.
  if (!process.env.RESEND_API_KEY) {
    result.blocked = 'RESEND_API_KEY absente : les envois programmés attendent.';
    console.error('[scheduledEmails]', result.blocked);
    return result;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  for (const mail of due) {
    // Réservation : si un autre passage l'a déjà prise, on passe au suivant.
    const claim = await prisma.emailLog.updateMany({
      where: { id: mail.id, status: 'scheduled' },
      data: { status: 'sending' },
    });
    if (claim.count === 0) continue;

    try {
      const from = mail.fromAddress || (process.env.SMTP_FROM as string);
      // Reply-To recalculé à l'envoi : il ne dépend que de l'affaire et de
      // l'expéditeur, inutile de le stocker.
      const replyTo = buildReplyTo(mail.dealId, from);
      const cc = (mail.cc || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);

      const { data, error } = await resend.emails.send({
        from,
        to: mail.to,
        ...(cc.length > 0 ? { cc } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject: mail.subject,
        html: mail.body,
      });
      if (error) throw new Error(error.message);

      await prisma.emailLog.update({
        where: { id: mail.id },
        data: { status: 'sent', sentAt: new Date(), resendId: data?.id || null },
      });
      result.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // « failed » et non « scheduled » : on ne veut pas d'une boucle qui
      // rejoue indéfiniment un envoi refusé. La frise le signale, l'email
      // reste lisible et peut être renvoyé à la main.
      await prisma.emailLog.update({ where: { id: mail.id }, data: { status: 'failed' } });
      result.failed++;
      result.errors.push({ id: mail.id, message });
      console.error('[scheduledEmails]', mail.id, message);
    }
  }

  return result;
}

// Espacement du déclenchement opportuniste (ouverture d'une fiche affaire) :
// inutile de relever la file à chaque clic.
const VERROU = 'scheduledEmailsLastRun';
const INTERVALLE_MS = 60 * 1000;

/**
 * Relève la file seulement si le dernier passage remonte à plus d'une minute.
 * Silencieux et sans effet en cas d'échec : appelé depuis des lectures, il ne
 * doit jamais empêcher l'affichage.
 */
export async function sendDueEmailsIfDue(): Promise<SendDueResult | null> {
  try {
    const now = new Date();
    const value = now.toISOString();
    const existing = await prisma.appSetting.findUnique({ where: { key: VERROU } });

    if (!existing) {
      try {
        await prisma.appSetting.create({ data: { key: VERROU, value } });
      } catch {
        return null;   // créé en parallèle : l'autre requête s'en charge
      }
      return sendDueEmails(now);
    }

    const last = new Date(existing.value);
    if (Number.isFinite(last.getTime()) && now.getTime() - last.getTime() < INTERVALLE_MS) {
      return null;
    }
    // Prise du verrou : un seul appelant passe.
    const claimed = await prisma.appSetting.updateMany({
      where: { key: VERROU, value: existing.value },
      data: { value },
    });
    if (claimed.count === 0) return null;

    return sendDueEmails(now);
  } catch (err) {
    console.error('[sendDueEmailsIfDue]', err);
    return null;
  }
}
