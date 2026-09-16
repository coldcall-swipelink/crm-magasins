// src/lib/pv/notifications.ts
//
// Mails de suite du parcours : confirmation, rappel de la veille, rappel d'une
// heure avant, relance du lendemain.
//
// Ils sont écrits ici, en HTML simple et sobre — pas dans src/pv-assets/. Le
// mail d'invitation est une pièce de communication (dégradés, logo, rendu
// Outlook au pixel) ; ceux-ci sont utilitaires : une information, une heure, un
// lien. Les garder courts et lisibles vaut mieux que de les faire beaux.

import { pvRescheduleUrl, pvTimeZone } from '@/lib/pv/config';
import { escapeHtml } from '@/lib/pv/templates';

const BLEU = '#1A1AD9';
const ENCRE = '#0B0B3B';

/** « mardi 24 septembre à 9 h 30 », dans le fuseau de travail. */
export function formatCreneau(start: Date): string {
  const tz = pvTimeZone();
  const jour = new Intl.DateTimeFormat('fr-FR', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long',
  }).format(start);
  const heure = new Intl.DateTimeFormat('fr-FR', {
    timeZone: tz, hour: '2-digit', minute: '2-digit',
  })
    .format(start)
    .replace(':', ' h ');
  return `${jour} à ${heure}`;
}

/** « 9 h 30 » seul, pour le SMS et le rappel d'une heure avant. */
export function formatHeure(start: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: pvTimeZone(), hour: '2-digit', minute: '2-digit',
  })
    .format(start)
    .replace(':', ' h ');
}

function bouton(url: string, libelle: string): string {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;background:${BLEU};color:#fff;`
    + `text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px">${escapeHtml(libelle)}</a>`;
}

function enveloppe(corps: string): string {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body style="margin:0;padding:24px;background:#EEF1FB;`
    + `font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ENCRE}">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">`
    + `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" `
    + `style="width:560px;max-width:100%;background:#fff;border-radius:20px;padding:32px">`
    + `<tr><td style="font-size:16px;line-height:1.6">${corps}</td></tr></table>`
    + `</td></tr></table></body></html>`;
}

export interface DemoMailContext {
  magasin: string;
  start: Date;
  meetUrl: string;
  token: string;
  consultant: string;
}

/** Confirmation envoyée juste après la réservation, avec le .ics en pièce jointe. */
export function renderConfirmation(ctx: DemoMailContext): { subject: string; html: string } {
  const visio = ctx.meetUrl
    ? `<p style="margin:22px 0">${bouton(ctx.meetUrl, 'Rejoindre la visio')}</p>`
    : '';
  const corps =
    `<p style="margin:0 0 18px;font-size:22px;font-weight:700">Votre démo est confirmée</p>`
    + `<p style="margin:0 0 6px">Rendez-vous <b>${escapeHtml(formatCreneau(ctx.start))}</b>, `
    + `en visio, avec ${escapeHtml(ctx.consultant)}.</p>`
    + `<p style="margin:0 0 6px;color:#646A8F">15 minutes pour découvrir vos 2 CV de bouchers `
    + `pour ${escapeHtml(ctx.magasin)}.</p>`
    + visio
    + `<p style="margin:18px 0 0;font-size:14px;color:#646A8F">`
    + `L'invitation est en pièce jointe (Outlook, Apple Calendrier…). `
    + `Un empêchement ? <a href="${escapeHtml(pvRescheduleUrl(ctx.token))}" style="color:${BLEU}">`
    + `Déplacer le rendez-vous</a>.</p>`
    + `<p style="margin:14px 0 0;font-size:14px;color:#646A8F">`
    + `Nous vous enverrons un rappel la veille et 1 h avant.</p>`;
  return { subject: `Démo confirmée — ${formatCreneau(ctx.start)}`, html: enveloppe(corps) };
}

/** Rappel de la veille. */
export function renderReminderDayBefore(ctx: DemoMailContext): { subject: string; html: string } {
  const corps =
    `<p style="margin:0 0 18px;font-size:22px;font-weight:700">Votre démo, c'est demain</p>`
    + `<p style="margin:0 0 6px"><b>${escapeHtml(formatCreneau(ctx.start))}</b>, en visio, 15 minutes.</p>`
    + `<p style="margin:0 0 6px;color:#646A8F">Nous vous présenterons vos 2 CV de bouchers.</p>`
    + (ctx.meetUrl ? `<p style="margin:22px 0">${bouton(ctx.meetUrl, 'Rejoindre la visio')}</p>` : '')
    + `<p style="margin:18px 0 0;font-size:14px;color:#646A8F">`
    + `Un empêchement ? <a href="${escapeHtml(pvRescheduleUrl(ctx.token))}" style="color:${BLEU}">`
    + `Déplacer le rendez-vous</a>.</p>`;
  return { subject: `Demain ${formatHeure(ctx.start)} : votre démo Swipelink`, html: enveloppe(corps) };
}

/** Rappel d'une heure avant. */
export function renderReminderHourBefore(ctx: DemoMailContext): { subject: string; html: string } {
  const corps =
    `<p style="margin:0 0 18px;font-size:22px;font-weight:700">Votre démo est dans 1 h</p>`
    + `<p style="margin:0 0 6px">À <b>${escapeHtml(formatHeure(ctx.start))}</b>, en visio, 15 minutes.</p>`
    + (ctx.meetUrl ? `<p style="margin:22px 0">${bouton(ctx.meetUrl, 'Rejoindre la visio')}</p>` : '')
    + `<p style="margin:18px 0 0;font-size:14px;color:#646A8F">À tout à l'heure.</p>`;
  return { subject: `Dans 1 h : votre démo Swipelink`, html: enveloppe(corps) };
}

export interface FollowUpContext {
  magasin: string;
  prenom: string;
  nbProfils: number;
  token: string;
  lien: string;
  consultant: string;
}

/**
 * Relance du lendemain, pour les parcours COMMENCÉS et non réservés.
 *
 * Elle ne part jamais sur un simple clic dans le mail : les Safe Links de
 * Microsoft ouvrent les liens à la place du destinataire, si bien qu'un clic ne
 * prouve la présence de personne. Seules les réponses aux questions (events
 * answer_*) déclenchent cette relance — celles-là, aucune machine ne les coche.
 */
export function renderFollowUp(ctx: FollowUpContext): { subject: string; html: string } {
  const bonjour = ctx.prenom ? `Bonjour ${escapeHtml(ctx.prenom)},` : 'Bonjour,';
  const corps =
    `<p style="margin:0 0 18px">${bonjour}</p>`
    + `<p style="margin:0 0 6px">Vous avez commencé à nous décrire le poste de boucher `
    + `de ${escapeHtml(ctx.magasin)}, sans choisir de créneau.</p>`
    + `<p style="margin:0 0 6px">Vos réponses sont gardées : il ne reste qu'à choisir l'horaire `
    + `qui vous arrange pour découvrir vos 2 CV.</p>`
    + `<p style="margin:22px 0">${bouton(ctx.lien, 'Choisir mon créneau')}</p>`
    + `<p style="margin:18px 0 0;font-size:14px;color:#646A8F">`
    + `${ctx.nbProfils} bouchers sont repérés autour de votre magasin. `
    + `— ${escapeHtml(ctx.consultant)}, Swipelink</p>`;
  return { subject: `Vos 2 CV de bouchers vous attendent`, html: enveloppe(corps) };
}
