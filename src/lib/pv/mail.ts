// src/lib/pv/mail.ts
//
// Les mails du pilote : invitation, confirmation, rappels, relance.
//
// DEUX CHEMINS D'ENVOI, et ce n'est pas un doublon :
//
//   • L'INVITATION part d'une boîte SMTP de l'outil Campagnes (table Mailbox).
//     C'est un message froid, envoyé à un directeur qui ne nous connaît pas :
//     il a besoin d'un domaine d'envoi dédié, d'un préchauffage (warmupStart /
//     warmupStep), d'un plafond quotidien et d'une cadence irrégulière — tout
//     ce que la boîte porte déjà. C'est aussi le seul chemin qui sache
//     convertir le logo en image intégrée : nodemailer, avec attachDataUrls,
//     transforme le data: URI du modèle en pièce jointe CID, ce qu'Outlook et
//     Gmail affichent sans demander « Télécharger les images ».
//
//   • LES MAILS DE SUITE (confirmation, rappels, relance) partent par Resend,
//     comme le reste du CRM : ce sont des messages attendus, adressés à
//     quelqu'un qui vient d'interagir avec nous, et Resend les délivre sans
//     consommer le quota de préchauffage du domaine froid.
//
// Si aucune boîte SMTP n'est configurée, l'invitation repart par Resend : le
// pilote reste utilisable, on le signale simplement dans le résultat.

import { Resend } from 'resend';
import type { Mailbox } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createTransport, fromHeader } from '@/lib/campaigns/mailboxes';
import { htmlToText } from '@/lib/campaigns/render';
import {
  pvParcoursUrl,
  pvSenderEmail,
  pvSenderName,
  pvUnsubscribeUrl,
} from '@/lib/pv/config';
import { fillTemplate, mailTemplate, removeBlock } from '@/lib/pv/templates';
import { referencesSentence, referencesTitle, type PvReference } from '@/lib/pv/references';
import { pitchFor } from '@/lib/pv/pitch';

export interface InvitationContext {
  /** Nom complet du magasin (« E.Leclerc Montpellier Est »). */
  magasin: string;
  /** Enseigne seule (« E.Leclerc »), pour l'objet du mail. */
  enseigne: string;
  ville: string;
  /** Prénom du directeur, s'il est connu. */
  prenom: string;
  /** Intitulé de l'offre publiée (« Boucher (H/F) »). */
  intituleOffre: string;
  /** Date de publication de l'offre, déjà formatée (« 12 mars »). */
  datePublication: string;
  nbProfils: number;
  references: PvReference[];
  token: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Adresse postale de l'éditeur, obligatoire en bas d'un message commercial. */
function adressePostale(): string {
  return process.env.PV_LEGAL_ADDRESS || 'Swipelink SAS, France';
}

/**
 * Ce que le mail répond à « On y gagne quoi, nous ? » : le contexte par
 * enseigne (le même que le volet gauche de la page), puis ce qui se passe après
 * le test. Sans « gratuit » ni « offert » : ces mots faisaient tomber le mail en
 * courrier indésirable. « 0 € » et « aucune facturation » passent.
 */
const GAIN_FIN =
  "Si les profils vous plaisent, vous les embauchez : aucune facturation, même dans ce cas. " +
  'Si le test vous convainc, on continue ensemble ; sinon, on en reste là.';

/**
 * Mail d'invitation, modèle rempli.
 *
 * Le bloc « déjà avec Swipelink dans votre région » est RETIRÉ quand le magasin
 * n'a aucune référence citable à proximité : un encadré vide, ou pire une
 * promesse creuse, abîme la confiance qu'on cherche justement à installer.
 */
export function renderInvitation(ctx: InvitationContext): RenderedEmail {
  const refs = referencesSentence(ctx.references);
  const pitch = pitchFor(ctx.enseigne || ctx.magasin);
  let html = mailTemplate();
  if (!refs) html = removeBlock(html, 'refs');
  if (!pitch.appelMail) html = removeBlock(html, 'appel');

  html = fillTemplate(html, {
    Enseigne: ctx.enseigne || ctx.magasin,
    Magasin: ctx.magasin,
    N: String(ctx.nbProfils),
    'Prénom': ctx.prenom,
    "Intitulé de l'offre": ctx.intituleOffre || 'Boucher (H/F)',
    Ville: ctx.ville,
    References: refs,
    ReferencesTitre: referencesTitle(ctx.references, ctx.enseigne),
    Gain1: pitch.texteMail[0],
    Gain2: pitch.texteMail[1],
    GainFin: GAIN_FIN,
    GainAppel: pitch.appelMail,
    TelHref: pitch.contact.href,
    token: ctx.token,
    date: ctx.datePublication,
    adresse: adressePostale(),
    'domaine-envoi': pvSenderEmail().split('@')[1] || 'swipelink.fr',
  });

  // Sans prénom connu, « Bonjour {{Prénom}}, » donnerait « Bonjour , ».
  html = html.replace(/Bonjour\s+,/, 'Bonjour,');

  const subject = `2 CV de bouchers pour votre magasin ${ctx.enseigne || ctx.magasin}`;

  // Les deux mots qui ont envoyé ce mail en indésirable ne doivent plus y
  // figurer, ni dans le modèle ni dans ce qu'on y injecte (nom de magasin,
  // références…). On prévient sans bloquer : un mail qui part avec un mot de
  // trop vaut mieux qu'un pilote à l'arrêt, et le journal dit où regarder.
  const motsInterdits = (subject + html).match(/gratuit|offert/gi);
  if (motsInterdits) {
    console.warn(`[pv/mail] mot à risque anti-spam dans l'invitation de ${ctx.magasin} : ${motsInterdits.join(', ')}`);
  }

  return { subject, html, text: htmlToText(html) };
}

/** Le lien du bouton, utile aux tests et à l'aperçu depuis le CRM. */
export function invitationLink(token: string): string {
  return pvParcoursUrl(token);
}

export interface SendResult {
  ok: boolean;
  /** « smtp » (boîte de campagne) ou « resend ». */
  via: 'smtp' | 'resend' | 'none';
  messageId: string;
  error?: string;
}

/** Boîte SMTP d'envoi du pilote, si elle existe et qu'elle est active. */
export async function pvMailbox(): Promise<Mailbox | null> {
  return prisma.mailbox.findFirst({
    where: { email: pvSenderEmail(), active: true },
  });
}

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Jeton du magasin : sert à construire le lien de désinscription. */
  token?: string;
  attachments?: Array<{ filename: string; content: string | Buffer; contentType: string }>;
  /** Affaire à tracer dans la frise. Aucun journal si absent. */
  dealId?: string;
}

/**
 * En-têtes de désinscription. Gmail et Outlook affichent un lien natif
 * « Se désabonner » quand ils les voient, ce qui vaut infiniment mieux qu'un
 * signalement en courrier indésirable.
 */
function unsubscribeHeaders(token?: string): Record<string, string> {
  if (!token) return {};
  return {
    'List-Unsubscribe': `<${pvUnsubscribeUrl(token)}>, <mailto:${pvSenderEmail()}?subject=desinscription>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/** Envoi par la boîte SMTP du pilote (logo converti en image intégrée). */
async function sendViaMailbox(mailbox: Mailbox, input: SendMailInput): Promise<SendResult> {
  // attachDataUrls : nodemailer remplace les `src="data:image/png;base64,…"`
  // du modèle par des pièces jointes inline référencées en cid:. Sans cette
  // option, Outlook n'affiche tout simplement pas le logo.
  const transport = createTransport(mailbox, { attachDataUrls: true });
  try {
    const info = await transport.sendMail({
      from: fromHeader(mailbox),
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      headers: unsubscribeHeaders(input.token),
      attachments: input.attachments,
    });
    return { ok: true, via: 'smtp', messageId: info.messageId || '' };
  } finally {
    transport.close();
  }
}

/** Envoi par Resend. */
async function sendViaResend(input: SendMailInput): Promise<SendResult> {
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, via: 'none', messageId: '', error: 'RESEND_API_KEY absente' };
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: `${pvSenderName()} <${pvSenderEmail()}>`,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    headers: unsubscribeHeaders(input.token),
    attachments: input.attachments?.map(a => ({
      filename: a.filename,
      content: typeof a.content === 'string' ? Buffer.from(a.content, 'utf8') : a.content,
      contentType: a.contentType,
    })),
  });
  if (error) return { ok: false, via: 'resend', messageId: '', error: error.message };
  return { ok: true, via: 'resend', messageId: data?.id || '' };
}

/**
 * Envoie un mail du pilote et le consigne dans la frise de l'affaire.
 *
 * `preferMailbox` distingue les deux chemins décrits en tête de fichier :
 * l'invitation le demande, les mails de suite non.
 */
export async function sendPvMail(
  input: SendMailInput,
  options: { preferMailbox?: boolean } = {},
): Promise<SendResult> {
  let result: SendResult;
  try {
    const mailbox = options.preferMailbox ? await pvMailbox() : null;
    result = mailbox ? await sendViaMailbox(mailbox, input) : await sendViaResend(input);
  } catch (err) {
    result = { ok: false, via: 'none', messageId: '', error: (err as Error).message };
  }

  if (input.dealId) {
    // Le journal est un confort, jamais une condition de l'envoi : s'il échoue,
    // l'email est parti quand même et c'est ce qui compte.
    try {
      await prisma.emailLog.create({
        data: {
          dealId: input.dealId,
          direction: 'outbound',
          fromAddress: pvSenderEmail(),
          to: input.to,
          subject: input.subject,
          body: input.html,
          status: result.ok ? 'sent' : 'failed',
          messageId: result.messageId || null,
        },
      });
    } catch (err) {
      console.error('[pv/mail] journal impossible :', err);
    }
  }

  return result;
}
