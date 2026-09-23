// src/lib/emailOpenNotifications.ts
//
// Création (auto-réparante) des notifications « email ouvert ».
//
// Pourquoi ce fichier : le `prisma db push` du build (scripts/db-sync.mjs) est
// volontairement non bloquant — s'il échoue, le code se déploie SANS sa table
// et la création de notification échouait en silence (le statut « Ouvert »
// se mettait à jour, mais aucune alerte n'apparaissait). Comme pour les outils
// Campagnes/PV (cf. src/lib/campaigns/schemaSql.ts), le DDL strictement additif
// vit ici : au premier échec d'écriture, on crée la table puis on réessaie.
//
// Aucune instruction destructrice : CREATE TABLE / CREATE INDEX en
// « IF NOT EXISTS » uniquement. Rejouer la liste sur une base à jour ne fait
// rien. La contrainte FK vers Deal est laissée à `prisma db push`, comme pour
// les autres tables créées par la route /api/admin/db-sync.

import { prisma } from '@/lib/prisma';

export const EMAIL_OPEN_NOTIFICATION_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "EmailOpenNotification" (
    "id" TEXT NOT NULL,
    "emailLogId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "senderEmail" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "openedAt" TIMESTAMP(3) NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailOpenNotification_pkey" PRIMARY KEY ("id")
  );`,
  // Colonnes ajoutées après la première version de la table : rejouées en
  // ALTER pour les bases où elle existe déjà.
  'ALTER TABLE "EmailOpenNotification" ADD COLUMN IF NOT EXISTS "senderUserId" TEXT;',
  // Attribution de l'envoi au user CRM connecté (cf. schema.prisma). Posée ici
  // aussi car EmailLog est écrite avant que `prisma db push` soit garanti.
  'ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "sentByUserId" TEXT;',
  'CREATE UNIQUE INDEX IF NOT EXISTS "EmailOpenNotification_emailLogId_key" ON "EmailOpenNotification"("emailLogId");',
  'CREATE INDEX IF NOT EXISTS "EmailOpenNotification_dealId_idx" ON "EmailOpenNotification"("dealId");',
  'CREATE INDEX IF NOT EXISTS "EmailOpenNotification_senderUserId_idx" ON "EmailOpenNotification"("senderUserId");',
  'CREATE INDEX IF NOT EXISTS "EmailOpenNotification_senderEmail_isRead_openedAt_idx" ON "EmailOpenNotification"("senderEmail","isRead","openedAt");',
];

// Une seule tentative de création par instance : une fois la table en place
// (ou confirmée en place), inutile de rejouer le DDL à chaque écriture.
let ensured = false;

/** Crée la table et ses index si absents (idempotent, purement additif). */
export async function ensureEmailOpenNotificationTable(): Promise<void> {
  if (ensured) return;
  for (const sql of EMAIL_OPEN_NOTIFICATION_SCHEMA_STATEMENTS) {
    await prisma.$executeRawUnsafe(sql);
  }
  ensured = true;
  await backfillRecentOpens();
}

// Rattrapage joué une fois, juste après la création de la table : les emails
// ouverts pendant qu'elle manquait n'ont pas pu créer leur notification. On
// matérialise ceux des dernières 24 h (fenêtre courte : au-delà, « appeler
// tout de suite » n'a plus de sens). Idempotent grâce à skipDuplicates +
// unicité d'emailLogId ; jamais bloquant.
async function backfillRecentOpens(): Promise<void> {
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const opened = await prisma.emailLog.findMany({
      where: { direction: 'outbound', openedAt: { gte: since } },
      select: { id: true, dealId: true, sentByUserId: true, fromAddress: true, subject: true, openedAt: true },
    });
    if (opened.length === 0) return;
    await prisma.emailOpenNotification.createMany({
      data: opened.map((log) => ({
        emailLogId: log.id,
        dealId: log.dealId,
        senderUserId: log.sentByUserId || null,
        senderEmail: (log.fromAddress || '').toLowerCase(),
        subject: log.subject,
        openedAt: log.openedAt as Date,
      })),
      skipDuplicates: true,
    });
    console.log(`[emailOpenNotifications] rattrapage : ${opened.length} ouverture(s) récente(s) matérialisée(s).`);
  } catch (err) {
    console.warn('[emailOpenNotifications] rattrapage impossible (non bloquant) :', err);
  }
}

export interface EmailOpenNotificationInput {
  emailLogId: string;
  dealId: string;
  senderUserId: string | null;
  senderEmail: string;
  subject: string;
  openedAt: Date;
}

/**
 * Insère les notifications d'ouverture (dédupliquées par emailLogId). Si la
 * table n'existe pas encore (base jamais synchronisée), elle est créée puis
 * l'insertion est rejouée : la première ouverture reçue répare la base.
 */
export async function createEmailOpenNotifications(rows: EmailOpenNotificationInput[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await prisma.emailOpenNotification.createMany({ data: rows, skipDuplicates: true });
  } catch (err) {
    console.warn('[emailOpenNotifications] insertion échouée, tentative de création de la table…', err);
    await ensureEmailOpenNotificationTable();
    await prisma.emailOpenNotification.createMany({ data: rows, skipDuplicates: true });
  }
}
