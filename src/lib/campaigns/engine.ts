// src/lib/campaigns/engine.ts
//
// Moteur d'envoi des campagnes.
//
// Principe : le moteur ne « déroule » jamais une campagne d'un bloc. Il relève
// les INSCRIPTIONS (un lead dans une campagne) dont l'heure est venue, boîte
// par boîte, et n'envoie que ce que les garde-fous de la boîte autorisent —
// fenêtre horaire, quota du jour, espacement entre deux messages. Arrêter un
// lead, une campagne ou une boîte n'a donc aucun effet sur le reste.
//
// Déclenchement : POST /api/campaigns/run, appelée par le cron (vercel.json).
// Chaque passage dispose d'un budget de temps ; ce qui n'a pas pu partir part
// au passage suivant. Deux passages simultanés ne peuvent pas doubler un
// envoi : chaque inscription est RÉSERVÉE (« active » → « sending ») par une
// mise à jour conditionnelle avant tout envoi.

import type { Mailbox } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createTransport, fromHeader } from '@/lib/campaigns/mailboxes';
import { BLOCKING_STATUSES } from '@/lib/campaigns/leadFields';
import { buildEmail, leadVariables, threadSubject } from '@/lib/campaigns/render';
import {
  dailyCap, isSendWindowOpen, nextOpenSlot, randomDelayMs, startOfLocalDay,
} from '@/lib/campaigns/schedule';

/** Budget de temps d'un passage, en millisecondes (marge sous maxDuration). */
const DEFAULT_BUDGET_MS = 240_000;

export type RunResult = {
  sent: number;
  failed: number;
  finished: number;
  stopped: number;
  /** Boîtes écartées et pourquoi : la route le renvoie tel quel au superviseur. */
  skipped: Array<{ mailbox: string; reason: string }>;
  errors: Array<{ enrollmentId: string; message: string }>;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Envoie tout ce qui peut partir maintenant.
 * Les boîtes travaillent en parallèle (elles sont indépendantes), les envois
 * d'une même boîte restent séquentiels et espacés.
 */
export async function runDueSends(options: { budgetMs?: number; now?: Date } = {}): Promise<RunResult> {
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  const now = options.now ?? new Date();

  const result: RunResult = { sent: 0, failed: 0, finished: 0, stopped: 0, skipped: [], errors: [] };

  // Reprise après incident : une inscription laissée « sending » par un passage
  // interrompu (fonction coupée, redéploiement) resterait bloquée pour
  // toujours. Au-delà du délai ci-dessous, aucun envoi ne peut être encore en
  // cours : on la remet en file.
  const stale = await prisma.campaignEnrollment.updateMany({
    where: { status: 'sending', updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
    data: { status: 'active' },
  });
  if (stale.count > 0) {
    console.warn(`[campaigns/engine] ${stale.count} inscription(s) remise(s) en file après interruption`);
  }

  const mailboxes = await prisma.mailbox.findMany({ where: { active: true } });
  if (mailboxes.length === 0) {
    result.skipped.push({ mailbox: '—', reason: 'Aucune boîte active' });
    return result;
  }

  await Promise.all(mailboxes.map(mailbox => runMailbox(mailbox, deadline, now, result)));
  return result;
}

/** Boucle d'envoi d'une seule boîte, jusqu'à épuisement du budget ou de la file. */
async function runMailbox(mailbox: Mailbox, deadline: number, now: Date, result: RunResult) {
  if (!isSendWindowOpen(mailbox, now)) {
    result.skipped.push({ mailbox: mailbox.email, reason: 'Hors plage horaire' });
    return;
  }

  const cap = dailyCap(mailbox, now);
  const sentToday = await prisma.campaignMessage.count({
    where: {
      mailboxId: mailbox.id,
      status: 'sent',
      sentAt: { gte: startOfLocalDay(now, mailbox.timezone || 'Europe/Paris') },
    },
  });
  let remaining = cap - sentToday;
  if (remaining <= 0) {
    result.skipped.push({ mailbox: mailbox.email, reason: `Quota du jour atteint (${cap})` });
    return;
  }

  const transport = createTransport(mailbox);
  try {
    while (remaining > 0 && Date.now() < deadline) {
      // 1. Y a-t-il seulement quelque chose à envoyer ? Inutile de réserver un
      //    créneau — et de faire patienter la boîte — pour une file vide.
      const pending = await prisma.campaignEnrollment.findFirst({
        where: {
          mailboxId: mailbox.id, status: 'active', nextSendAt: { lte: new Date() },
          campaign: { status: 'running' },
        },
        select: { id: true },
      });
      if (!pending) break;

      // 2. Réservation du créneau d'envoi de la boîte. C'est ce qui empêche
      //    deux passages simultanés (cron qui se chevauche, appel manuel) de
      //    doubler la cadence : le premier avance `nextSendAt`, le second voit
      //    la boîte occupée et attend son tour.
      const delay = randomDelayMs(mailbox);
      const at = new Date();
      const slot = await prisma.mailbox.updateMany({
        where: { id: mailbox.id, OR: [{ nextSendAt: null }, { nextSendAt: { lte: at } }] },
        data: { nextSendAt: new Date(at.getTime() + delay) },
      });

      if (slot.count === 0) {
        // Créneau pris : on attend qu'il se libère, si le budget le permet.
        const fresh = await prisma.mailbox.findUnique({
          where: { id: mailbox.id }, select: { nextSendAt: true },
        });
        const wait = (fresh?.nextSendAt?.getTime() ?? Date.now()) - Date.now();
        if (wait <= 0) continue;
        if (Date.now() + wait > deadline) {
          result.skipped.push({ mailbox: mailbox.email, reason: 'Délai entre deux envois non écoulé' });
          break;
        }
        await sleep(wait);
        continue;
      }

      // 3. Envoi.
      const enrollment = await claimNextEnrollment(mailbox.id);
      if (!enrollment) break;

      const outcome = await sendEnrollmentStep(enrollment, mailbox, transport);
      if (outcome.kind === 'sent') { result.sent++; remaining--; }
      else if (outcome.kind === 'failed') { result.failed++; result.errors.push({ enrollmentId: enrollment.id, message: outcome.message }); }
      else {
        // Rien n'est parti (séquence terminée, ou lead écarté entre-temps) :
        // le créneau réservé est rendu, le lead suivant n'a pas à attendre un
        // délai d'envoi pour un email qui n'a jamais existé.
        if (outcome.kind === 'finished') result.finished++; else result.stopped++;
        await prisma.mailbox.update({ where: { id: mailbox.id }, data: { nextSendAt: new Date() } });
        continue;
      }

      // 4. Respect de l'espacement avant le message suivant.
      if (Date.now() + delay >= deadline) break;
      await sleep(delay);
    }
  } finally {
    transport.close();
  }
}

/** Inscription réservée pour cette boîte, ou null si la file est vide. */
async function claimNextEnrollment(mailboxId: string) {
  const candidate = await prisma.campaignEnrollment.findFirst({
    where: {
      mailboxId,
      status: 'active',
      nextSendAt: { lte: new Date() },
      campaign: { status: 'running' },
    },
    orderBy: { nextSendAt: 'asc' },
    select: { id: true },
  });
  if (!candidate) return null;

  // Réservation : un seul passage peut faire basculer « active » → « sending ».
  const claim = await prisma.campaignEnrollment.updateMany({
    where: { id: candidate.id, status: 'active' },
    data: { status: 'sending' },
  });
  if (claim.count === 0) return null;

  return prisma.campaignEnrollment.findUnique({
    where: { id: candidate.id },
    include: {
      lead: true,
      campaign: { include: { steps: { orderBy: { position: 'asc' } } } },
    },
  });
}

type ClaimedEnrollment = NonNullable<Awaited<ReturnType<typeof claimNextEnrollment>>>;
type Outcome =
  | { kind: 'sent' }
  | { kind: 'failed'; message: string }
  | { kind: 'finished' }
  | { kind: 'stopped' };

/** Envoie l'étape courante d'une inscription réservée, puis la reprogramme. */
async function sendEnrollmentStep(
  enrollment: ClaimedEnrollment,
  mailbox: Mailbox,
  transport: ReturnType<typeof createTransport>,
): Promise<Outcome> {
  const { lead, campaign } = enrollment;

  // Garde-fous côté lead : désinscrit, adresse morte ou écarté à la main.
  // On ne se fie pas au seul statut de l'inscription : le lead a pu être
  // désinscrit depuis une autre campagne entre-temps.
  if (lead.unsubscribedAt || BLOCKING_STATUSES.includes(lead.status)) {
    await stopEnrollment(enrollment.id, lead.unsubscribedAt ? 'unsubscribed' : 'manual');
    return { kind: 'stopped' };
  }

  const steps = campaign.steps;
  const step = steps[enrollment.sentSteps];
  if (!step) {
    await finishEnrollment(enrollment.id);
    return { kind: 'finished' };
  }

  const isFollowUp = enrollment.sentSteps > 0 && step.replyToThread && Boolean(enrollment.threadMessageId);
  const message = await prisma.campaignMessage.create({
    data: {
      campaignId: campaign.id,
      enrollmentId: enrollment.id,
      stepId: step.id,
      leadId: lead.id,
      mailboxId: mailbox.id,
      stepPosition: step.position,
      status: 'failed',            // rectifié après l'envoi réussi
      toAddress: lead.email,
      fromAddress: fromHeader(mailbox),
      subject: '',
      bodyHtml: '',
    },
  });

  const email = buildEmail({
    subjectTemplate: step.subject,
    bodyTemplate: step.useHtml ? step.bodyHtml : step.bodyText,
    useHtml: step.useHtml,
    variables: leadVariables(lead, mailbox),
    signatureHtml: mailbox.signatureHtml,
    trackingId: campaign.trackOpens ? message.trackingId : null,
    unsubscribeToken: campaign.addUnsubscribe ? message.trackingId : null,
  });

  // Une relance garde le sujet du premier email, préfixé « Re: » : c'est ce
  // qui la range dans le même fil chez le destinataire.
  const subject = isFollowUp
    ? threadSubject(enrollment.threadSubject || email.subject)
    : email.subject;

  try {
    const info = await transport.sendMail({
      from: fromHeader(mailbox),
      to: lead.email,
      subject,
      text: email.text,
      html: email.html,
      ...(isFollowUp
        ? { inReplyTo: enrollment.threadMessageId!, references: [enrollment.threadMessageId!] }
        : {}),
      ...(email.unsubscribeUrl
        ? {
            list: { unsubscribe: { url: email.unsubscribeUrl, comment: 'Se désinscrire' } },
            // Désinscription en un clic depuis le bandeau de Gmail (RFC 8058) :
            // Google la réclame pour tout envoi de masse, et c'est la voie de
            // sortie la plus propre pour le destinataire.
            headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
          }
        : {}),
    });

    await prisma.campaignMessage.update({
      where: { id: message.id },
      data: {
        status: 'sent',
        subject,
        bodyHtml: email.html,
        messageId: info.messageId || null,
        sentAt: new Date(),
      },
    });

    // Reprogrammation : étape suivante, ou fin de parcours.
    const nextStep = steps[enrollment.sentSteps + 1];
    const sentSteps = enrollment.sentSteps + 1;
    const nextAt = nextStep
      ? nextOpenSlot(mailbox, new Date(Date.now() + nextStep.delayHours * 3_600_000))
      : null;

    await prisma.campaignEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: nextStep ? 'active' : 'finished',
        stopReason: nextStep ? null : 'completed',
        sentSteps,
        nextSendAt: nextAt,
        startedAt: enrollment.startedAt ?? new Date(),
        finishedAt: nextStep ? null : new Date(),
        // Le fil s'accroche au PREMIER message envoyé.
        threadMessageId: enrollment.threadMessageId ?? info.messageId ?? null,
        threadSubject: enrollment.threadSubject ?? subject,
      },
    });

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        lastContactedAt: new Date(),
        // Un lead « nouveau » devient « contacté » ; les autres statuts, posés
        // à la main, ne sont jamais écrasés par le moteur.
        ...(lead.status === 'new' ? { status: 'contacted', statusAt: new Date() } : {}),
      },
    });

    await prisma.leadEvent.create({
      data: {
        leadId: lead.id,
        type: 'email_sent',
        label: `Étape ${step.position} · ${campaign.name} — « ${subject} »`,
        payload: { campaignId: campaign.id, messageId: message.id, mailbox: mailbox.email },
      },
    });

    return { kind: 'sent' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await prisma.campaignMessage.update({
      where: { id: message.id },
      data: { status: 'failed', subject, error: reason.slice(0, 500) },
    });

    // Adresse refusée définitivement (5.1.1 / 550) : le lead est mort, on
    // arrête sa séquence. Toute autre erreur est un incident passager, on
    // repasse l'inscription en file pour le prochain créneau.
    const permanent = /(^|\D)5\.[0-9]\.[0-9]|\b550\b|\b553\b|mailbox (unavailable|not found)|no such user/i.test(reason);
    if (permanent) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: 'bounced', statusAt: new Date(), bouncedAt: new Date() },
      });
      await prisma.leadEvent.create({
        data: { leadId: lead.id, type: 'bounced', label: `Adresse refusée : ${reason.slice(0, 160)}` },
      });
      await stopEnrollment(enrollment.id, 'bounced');
    } else {
      await prisma.campaignEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'active', nextSendAt: new Date(Date.now() + 30 * 60_000) },
      });
    }
    return { kind: 'failed', message: reason };
  }
}

/** Arrête l'inscription d'UN lead, sans toucher au reste de la campagne. */
export async function stopEnrollment(enrollmentId: string, reason: string) {
  await prisma.campaignEnrollment.update({
    where: { id: enrollmentId },
    data: { status: 'stopped', stopReason: reason, nextSendAt: null, finishedAt: new Date() },
  });
}

async function finishEnrollment(enrollmentId: string) {
  await prisma.campaignEnrollment.update({
    where: { id: enrollmentId },
    data: { status: 'finished', stopReason: 'completed', nextSendAt: null, finishedAt: new Date() },
  });
}

// ─── Inscription de leads dans une campagne ───────────────────────────────

export type EnrollResult = { enrolled: number; skipped: number; reasons: Record<string, number> };

/**
 * Inscrit des leads dans une campagne.
 *
 * Chaque lead reçoit UNE boîte, tirée en rotation sur les boîtes de la
 * campagne : la séquence entière partira de cette adresse, sinon les relances
 * ne se rattacheraient pas au fil du premier email.
 *
 * Les leads désinscrits, en adresse morte ou déjà inscrits sont écartés — avec
 * le décompte des raisons, affiché à l'écran.
 */
export async function enrollLeads(campaignId: string, leadIds: string[]): Promise<EnrollResult> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      steps: { orderBy: { position: 'asc' }, take: 1 },
      mailboxes: { include: { mailbox: true } },
    },
  });
  if (!campaign) throw new Error('Campagne introuvable');

  const boxes = campaign.mailboxes.map(link => link.mailbox).filter(box => box.active);
  if (boxes.length === 0) throw new Error("Aucune boîte d'envoi active n'est affectée à cette campagne");

  const result: EnrollResult = { enrolled: 0, skipped: 0, reasons: {} };
  const note = (reason: string) => {
    result.skipped++;
    result.reasons[reason] = (result.reasons[reason] || 0) + 1;
  };

  // Rotation : on reprend là où la campagne s'était arrêtée, pour que deux
  // inscriptions successives ne chargent pas toujours la même boîte.
  let cursor = await prisma.campaignEnrollment.count({ where: { campaignId } });

  const leads = await prisma.lead.findMany({ where: { id: { in: leadIds } } });
  const firstDelay = campaign.steps[0]?.delayHours ?? 0;

  for (const lead of leads) {
    if (lead.unsubscribedAt) { note('Désinscrit'); continue; }
    if (BLOCKING_STATUSES.includes(lead.status)) { note(`Statut « ${lead.status} »`); continue; }

    const exists = await prisma.campaignEnrollment.findUnique({
      where: { campaignId_leadId: { campaignId, leadId: lead.id } },
      select: { id: true },
    });
    if (exists) { note('Déjà inscrit'); continue; }

    const mailbox = boxes[cursor % boxes.length];
    cursor++;

    // Premier envoi : au prochain créneau ouvert de la boîte choisie.
    const nextSendAt = nextOpenSlot(mailbox, new Date(Date.now() + firstDelay * 3_600_000));

    await prisma.campaignEnrollment.create({
      data: {
        campaignId, leadId: lead.id, mailboxId: mailbox.id,
        status: 'active', nextSendAt,
      },
    });
    await prisma.leadEvent.create({
      data: {
        leadId: lead.id,
        type: 'enrolled',
        label: `Inscrit dans « ${campaign.name} » (envoi depuis ${mailbox.email})`,
        payload: { campaignId },
      },
    });
    result.enrolled++;
  }

  return result;
}
