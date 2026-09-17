// src/lib/pv/schemaSql.ts
//
// Création des tables du parcours boucher, en SQL brut et strictement additif.
//
// Pourquoi ce fichier, alors que le build lance déjà scripts/db-sync.mjs : parce
// que ce script s'exécute depuis le BUILD, qui ne joint pas toujours la base
// (pooler injoignable, pare-feu). Il est volontairement non bloquant — un souci
// de connexion ne doit pas empêcher tous les déploiements — mais la contrepartie
// est un déploiement vert sur une base en retard. Et un schéma Prisma en avance
// sur sa base ne casse pas seulement la nouveauté : le client généré lit TOUTES
// les colonnes déclarées, si bien qu'une colonne manquante sur Deal fait échouer
// jusqu'à l'import des offres.
//
// Cette liste, servie par /api/admin/db-sync, rattrape la base DEPUIS
// L'APPLICATION DÉPLOYÉE — qui, elle, joint la base. Aucun terminal requis.
//
// Rien de destructeur : uniquement CREATE TABLE / ADD COLUMN / CREATE INDEX en
// « IF NOT EXISTS », et des contraintes enveloppées dans un bloc qui avale
// l'erreur « existe déjà ». Rejouer la liste sur une base à jour ne fait rien.

export const PV_SCHEMA_STATEMENTS: string[] = [
  // ─── Colonne ajoutée à CampaignStep ─────────────────────────────────────
  // Une étape de séquence peut porter le modèle « 2 CV de bouchers ». Sans
  // cette colonne, le client Prisma fait échouer TOUTE lecture d'étape — donc
  // l'éditeur de séquence ET le moteur d'envoi, pour toutes les campagnes.
  `ALTER TABLE "CampaignStep" ADD COLUMN IF NOT EXISTS "templateKey" TEXT NOT NULL DEFAULT '';`,

  // ─── Colonnes ajoutées à Deal ────────────────────────────────────────────
  // C'est « citableReference » qui manquait et qui faisait tomber toute lecture
  // d'affaire (import des offres, pipeline, carte, fiche).
  `ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "citableReference" BOOLEAN NOT NULL DEFAULT false;`,
  `ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "pvExperience" TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "pvSalaire" TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "pvPriseDePoste" TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "pvEmailValidatedAt" TIMESTAMP(3);`,
  `ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "pvCguAcceptedAt" TIMESTAMP(3);`,

  // ─── PvInvite : l'invitation d'un magasin ────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "PvInvite" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCipher" TEXT NOT NULL DEFAULT '',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "nbProfils" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "messageId" TEXT NOT NULL DEFAULT '',
    "experience" TEXT NOT NULL DEFAULT '',
    "salaire" TEXT NOT NULL DEFAULT '',
    "salaireType" TEXT NOT NULL DEFAULT '',
    "priseDePoste" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "emailCorrected" BOOLEAN NOT NULL DEFAULT false,
    "cguAcceptedAt" TIMESTAMP(3),
    "callbackPhone" TEXT NOT NULL DEFAULT '',
    "callbackAt" TIMESTAMP(3),
    "followUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PvInvite_pkey" PRIMARY KEY ("id")
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PvInvite_tokenHash_key" ON "PvInvite"("tokenHash");`,
  `CREATE INDEX IF NOT EXISTS "PvInvite_dealId_idx" ON "PvInvite"("dealId");`,
  `CREATE INDEX IF NOT EXISTS "PvInvite_expiresAt_idx" ON "PvInvite"("expiresAt");`,

  // ─── PvBooking : la démo réservée, et le verrou des créneaux ─────────────
  `CREATE TABLE IF NOT EXISTS "PvBooking" (
    "id" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "slotKey" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "googleEventId" TEXT NOT NULL DEFAULT '',
    "meetUrl" TEXT NOT NULL DEFAULT '',
    "remindedDayBeforeAt" TIMESTAMP(3),
    "remindedHourBeforeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PvBooking_pkey" PRIMARY KEY ("id")
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PvBooking_inviteId_key" ON "PvBooking"("inviteId");`,
  // LE verrou : c'est cet index qui fait qu'une seule réservation peut tenir un
  // créneau, et que la seconde reçoit un 409.
  `CREATE UNIQUE INDEX IF NOT EXISTS "PvBooking_slotKey_key" ON "PvBooking"("slotKey");`,
  `CREATE INDEX IF NOT EXISTS "PvBooking_startAt_idx" ON "PvBooking"("startAt");`,
  `CREATE INDEX IF NOT EXISTS "PvBooking_dealId_idx" ON "PvBooking"("dealId");`,
  `CREATE INDEX IF NOT EXISTS "PvBooking_status_startAt_idx" ON "PvBooking"("status", "startAt");`,

  // ─── PvEvent : l'entonnoir, anonyme ─────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "PvEvent" (
    "id" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PvEvent_pkey" PRIMARY KEY ("id")
  );`,
  `CREATE INDEX IF NOT EXISTS "PvEvent_inviteId_createdAt_idx" ON "PvEvent"("inviteId", "createdAt");`,
  `CREATE INDEX IF NOT EXISTS "PvEvent_event_createdAt_idx" ON "PvEvent"("event", "createdAt");`,

  // ─── Clés étrangères ────────────────────────────────────────────────────
  `DO $$ BEGIN
  ALTER TABLE "PvInvite" ADD CONSTRAINT "PvInvite_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "PvBooking" ADD CONSTRAINT "PvBooking_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "PvInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "PvEvent" ADD CONSTRAINT "PvEvent_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "PvInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
];
