// src/app/api/campaigns/[id]/diagnostics/route.ts
//
//   GET /api/campaigns/<id>/diagnostics
//
// « Pourquoi ça n'envoie pas ? » — la question posée au système plutôt qu'à
// celui qui regarde l'écran.
//
// Une campagne peut rester muette pour une dizaine de raisons parfaitement
// légitimes (jamais lancée, hors plage horaire, quota atteint, boîte en
// panne, planificateur à l'arrêt). Aucune n'était visible : l'interface
// affichait « 0 envoyé » sans jamais dire lequel de ces verrous était fermé.
// Cette route les passe tous en revue et renvoie, pour chacun, un verdict
// lisible.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { lastCronRun, lastEngineRun } from '@/lib/campaigns/engine';
import { dailyCap, isSendWindowOpen, nextOpenSlot, startOfLocalDay } from '@/lib/campaigns/schedule';

export const dynamic = 'force-dynamic';

type Check = {
  key: string;
  label: string;
  /** ok : rien à faire · warn : peut expliquer l'attente · error : bloquant. */
  level: 'ok' | 'warn' | 'error';
  detail: string;
};

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: params.id },
    include: {
      steps: { orderBy: { position: 'asc' } },
      mailboxes: { include: { mailbox: true } },
    },
  });
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  const now = new Date();
  const checks: Check[] = [];

  // 1. La campagne tourne-t-elle ?
  if (campaign.status === 'running') {
    checks.push({ key: 'campaign', label: 'Campagne', level: 'ok', detail: 'En cours.' });
  } else {
    checks.push({
      key: 'campaign', label: 'Campagne', level: 'error',
      detail: campaign.status === 'draft'
        ? "Encore en brouillon : rien ne partira tant qu'elle n'est pas lancée (bouton « Lancer la campagne »)."
        : `Statut « ${campaign.status} » : le moteur ne relève que les campagnes en cours.`,
    });
  }

  // 2. Y a-t-il une étape rédigée ?
  const usable = campaign.steps.filter(step => step.subject.trim() && (step.bodyText.trim() || step.bodyHtml.trim()));
  checks.push(usable.length > 0
    ? { key: 'steps', label: 'Séquence', level: 'ok', detail: `${usable.length} étape(s) rédigée(s).` }
    : { key: 'steps', label: 'Séquence', level: 'error', detail: 'Aucune étape avec un sujet ET un corps.' });

  // 3. Des leads en attente d'envoi ?
  const [active, due, stopped, finished] = await Promise.all([
    prisma.campaignEnrollment.count({ where: { campaignId: params.id, status: 'active' } }),
    prisma.campaignEnrollment.count({
      where: { campaignId: params.id, status: 'active', nextSendAt: { lte: now } },
    }),
    prisma.campaignEnrollment.count({ where: { campaignId: params.id, status: 'stopped' } }),
    prisma.campaignEnrollment.count({ where: { campaignId: params.id, status: 'finished' } }),
  ]);

  if (active === 0 && stopped + finished === 0) {
    checks.push({
      key: 'leads', label: 'Leads', level: 'error',
      detail: 'Aucun lead inscrit dans la campagne.',
    });
  } else if (active === 0 && stopped === 0) {
    // Séquence terminée pour tout le monde : c'est un aboutissement, pas une
    // anomalie. L'afficher en rouge ferait chercher un problème inexistant.
    checks.push({
      key: 'leads', label: 'Leads', level: 'ok',
      detail: `Séquence terminée pour les ${finished} lead(s) inscrits. Ajoutez-en pour continuer.`,
    });
  } else if (active === 0) {
    checks.push({
      key: 'leads', label: 'Leads', level: 'warn',
      detail: `Aucun lead en attente : ${stopped} arrêté(s)`
        + (finished ? `, ${finished} terminé(s).` : '.'),
    });
  } else if (due === 0) {
    const next = await prisma.campaignEnrollment.findFirst({
      where: { campaignId: params.id, status: 'active', nextSendAt: { gt: now } },
      orderBy: { nextSendAt: 'asc' },
      select: { nextSendAt: true },
    });
    checks.push({
      key: 'leads', label: 'Leads', level: 'warn',
      detail: `${active} lead(s) en séquence, aucun dû maintenant`
        + (next?.nextSendAt ? ` — prochain le ${next.nextSendAt.toLocaleString('fr-FR')}.` : '.'),
    });
  } else {
    checks.push({ key: 'leads', label: 'Leads', level: 'ok', detail: `${due} envoi(s) dû(s) maintenant.` });
  }

  // 4. Les boîtes d'envoi : rattachées, actives, dans leur plage, sous quota.
  const boxes = campaign.mailboxes.map(link => link.mailbox);
  if (boxes.length === 0) {
    checks.push({ key: 'mailboxes', label: "Boîtes d'envoi", level: 'error', detail: 'Aucune boîte affectée à la campagne.' });
  } else {
    for (const mailbox of boxes) {
      const sentToday = await prisma.campaignMessage.count({
        where: {
          mailboxId: mailbox.id, status: 'sent',
          sentAt: { gte: startOfLocalDay(now, mailbox.timezone || 'Europe/Paris') },
        },
      });
      const cap = dailyCap(mailbox, now);
      const open = isSendWindowOpen(mailbox, now);

      let level: Check['level'] = 'ok';
      let detail = `Prête · ${sentToday}/${cap} envoi(s) aujourd'hui.`;

      if (!mailbox.active) { level = 'error'; detail = 'En pause : elle n\'envoie rien.'; }
      else if (mailbox.lastCheckOk === false) {
        level = 'error';
        detail = `En échec — ${mailbox.lastError || 'dernier test négatif'}. Testez-la depuis l'onglet Boîtes d'envoi.`;
      } else if (!open) {
        level = 'warn';
        detail = `Hors plage d'envoi (${mailbox.sendStartHour} h–${mailbox.sendEndHour} h, ${mailbox.timezone}) — `
          + `reprise le ${nextOpenSlot(mailbox, now).toLocaleString('fr-FR')}.`;
      } else if (sentToday >= cap) {
        level = 'warn';
        detail = `Quota du jour atteint (${sentToday}/${cap}).`;
      } else if (mailbox.nextSendAt && mailbox.nextSendAt > now) {
        level = 'ok';
        detail = `Prête · prochain envoi possible à ${mailbox.nextSendAt.toLocaleTimeString('fr-FR')} `
          + `(espacement) · ${sentToday}/${cap} aujourd'hui.`;
      }

      checks.push({ key: `mailbox:${mailbox.id}`, label: mailbox.email, level, detail });
    }
  }

  // 5. Le planificateur tourne-t-il ? C'est le verrou le plus difficile à
  //    voir : tout peut être correct et n'avoir jamais été relevé.
  const [lastRun, cronRun] = await Promise.all([lastEngineRun(), lastCronRun()]);
  const since = (date: Date) => Math.round((now.getTime() - date.getTime()) / 60_000);

  // On regarde le planificateur, pas le moteur : un passage déclenché à la
  // main (lancement, inscription, « Envoyer maintenant ») ne prouve rien sur
  // les relances, qui ne partent QUE par lui.
  if (!cronRun) {
    checks.push({
      key: 'engine', label: 'Planificateur', level: 'error',
      detail: "N'a JAMAIS tourné"
        + (lastRun ? ` (le moteur, lui, a tourné il y a ${since(lastRun)} min, mais à la main).` : '.')
        + ' Les relances des étapes suivantes ne partiront donc pas toutes seules. Le cron '
        + '« /api/campaigns/run » n\'est pas déclenché : sur un hébergement qui limite les tâches '
        + 'planifiées à une par jour, appelez cette route depuis un planificateur externe (N8N…) '
        + 'toutes les 5 minutes.',
    });
  } else if (since(cronRun) > 20) {
    checks.push({
      key: 'engine', label: 'Planificateur', level: 'warn',
      detail: `Dernier passage automatique il y a ${since(cronRun)} minutes — il devrait passer `
        + 'toutes les 5 minutes. Tant qu\'il dort, les relances attendent.',
    });
  } else {
    checks.push({
      key: 'engine', label: 'Planificateur', level: 'ok',
      detail: `Dernier passage automatique il y a ${since(cronRun)} minute(s) : les relances `
        + 'partiront d\'elles-mêmes.',
    });
  }

  const blocking = checks.filter(check => check.level === 'error');
  return NextResponse.json({
    checks,
    ok: blocking.length === 0,
    cronRun,
    summary: blocking.length === 0
      ? 'Rien ne bloque : les envois partent au rythme des garde-fous des boîtes.'
      : blocking.map(check => `${check.label} — ${check.detail}`).join(' '),
    lastRun,
  });
}
