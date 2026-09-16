// src/lib/pv/auth.ts
//
// Garde des routes PV qui ne sont PAS publiques : génération d'invitations,
// rappels, relances. Mêmes jetons que le reste des tâches planifiées du CRM
// (CRON_SECRET en tête), acceptés en paramètre d'URL, en en-tête Authorization
// ou en x-webhook-token — selon ce que sait faire le planificateur qui appelle.
//
// À ne jamais confondre avec le jeton d'un magasin : celui-ci ouvre une page,
// celui-là commande des envois.

import type { NextRequest } from 'next/server';

export function isAuthorizedPvAdmin(req: NextRequest): boolean {
  const fourni = (
    req.nextUrl.searchParams.get('token') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    req.headers.get('x-webhook-token') ||
    ''
  ).trim();
  if (!fourni) return false;

  const acceptes = [process.env.CRON_SECRET, process.env.EMAIL_SYNC_TOKEN, process.env.OFFERS_WEBHOOK_TOKEN]
    .map(v => (v || '').trim())
    .filter(Boolean);
  return acceptes.includes(fourni);
}
