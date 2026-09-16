// src/lib/campaigns/schemaSql.ts
//
// Création des tables de l'outil Campagnes, en SQL brut et strictement additif.
//
// Pourquoi ce fichier : le build du CRM ne propageait pas le schéma vers la
// base (« build » se limitait à `prisma generate`), si bien qu'un déploiement
// livrait le code sans ses tables — et l'outil tombait en panne d'une façon
// difficile à lire (liste vide, formulaire sans fournisseurs). Le build lance
// désormais scripts/db-sync.mjs, et cette liste permet EN PLUS de rattraper
// une base en retard depuis l'application déployée, via la route
// /api/admin/db-sync déjà utilisée par le projet pour ce genre de reprise.
//
// Contenu engendré mécaniquement (jamais écrit à la main) par :
//   npx prisma migrate diff --from-schema-datamodel <schéma d'avant> \
//       --to-schema-datamodel prisma/schema.prisma --script
// puis rendu rejouable : CREATE ... IF NOT EXISTS, et contraintes enveloppées
// dans un bloc qui avale l'erreur « existe déjà ».
//
// Aucune instruction destructrice : que des CREATE TABLE, CREATE INDEX et
// ADD CONSTRAINT. Rejouer la liste sur une base à jour ne fait rien.

export const CAMPAIGN_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "Mailbox" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT 'custom',
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL DEFAULT 465,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
    "smtpUser" TEXT NOT NULL,
    "smtpSecret" TEXT NOT NULL,
    "imapHost" TEXT,
    "imapPort" INTEGER NOT NULL DEFAULT 993,
    "imapUser" TEXT,
    "imapSecret" TEXT,
    "imapFolder" TEXT NOT NULL DEFAULT 'INBOX',
    "imapCursor" INTEGER,
    "imapValidity" INTEGER,
    "dailyLimit" INTEGER NOT NULL DEFAULT 80,
    "minDelaySec" INTEGER NOT NULL DEFAULT 90,
    "maxDelaySec" INTEGER NOT NULL DEFAULT 300,
    "sendStartHour" INTEGER NOT NULL DEFAULT 8,
    "sendEndHour" INTEGER NOT NULL DEFAULT 19,
    "sendDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "warmupStart" INTEGER NOT NULL DEFAULT 0,
    "warmupStep" INTEGER NOT NULL DEFAULT 5,
    "warmupStartedAt" TIMESTAMP(3),
    "signatureHtml" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckAt" TIMESTAMP(3),
    "lastCheckOk" BOOLEAN,
    "lastError" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "nextSendAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);`,
  `CREATE TABLE IF NOT EXISTS "Lead" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "civility" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "jobTitle" TEXT,
    "company" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "city" TEXT,
    "country" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'new',
    "statusAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "source" TEXT,
    "importId" TEXT,
    "dealId" TEXT,
    "lastContactedAt" TIMESTAMP(3),
    "lastOpenedAt" TIMESTAMP(3),
    "lastRepliedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);`,
  `CREATE TABLE IF NOT EXISTS "LeadImport" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "total" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadImport_pkey" PRIMARY KEY ("id")
);`,
  `CREATE TABLE IF NOT EXISTS "LeadNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userName" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);`,
  `CREATE TABLE IF NOT EXISTS "LeadEvent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "payload" JSONB,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadEvent_pkey" PRIMARY KEY ("id")
);`,
  `CREATE TABLE IF NOT EXISTS "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
    "trackOpens" BOOLEAN NOT NULL DEFAULT true,
    "addUnsubscribe" BOOLEAN NOT NULL DEFAULT true,
    "userName" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);`,
  `CREATE TABLE IF NOT EXISTS "CampaignMailbox" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignMailbox_pkey" PRIMARY KEY ("id")
);`,
  `CREATE TABLE IF NOT EXISTS "CampaignStep" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "delayHours" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT NOT NULL DEFAULT '',
    "bodyText" TEXT NOT NULL DEFAULT '',
    "bodyHtml" TEXT NOT NULL DEFAULT '',
    "useHtml" BOOLEAN NOT NULL DEFAULT false,
    "replyToThread" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignStep_pkey" PRIMARY KEY ("id")
);`,
  `CREATE TABLE IF NOT EXISTS "CampaignEnrollment" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "stopReason" TEXT,
    "sentSteps" INTEGER NOT NULL DEFAULT 0,
    "nextSendAt" TIMESTAMP(3),
    "mailboxId" TEXT,
    "threadMessageId" TEXT,
    "threadSubject" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignEnrollment_pkey" PRIMARY KEY ("id")
);`,
  `CREATE TABLE IF NOT EXISTS "CampaignMessage" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "stepId" TEXT,
    "leadId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "stepPosition" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "toAddress" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "messageId" TEXT,
    "error" TEXT,
    "trackingId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3),
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "repliedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignMessage_pkey" PRIMARY KEY ("id")
);`,
  `CREATE TABLE IF NOT EXISTS "CampaignReply" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT,
    "leadId" TEXT,
    "campaignId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "snippet" TEXT NOT NULL DEFAULT '',
    "messageId" TEXT,
    "inReplyTo" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignReply_pkey" PRIMARY KEY ("id")
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Mailbox_email_key" ON "Mailbox"("email");`,
  `CREATE INDEX IF NOT EXISTS "Mailbox_active_idx" ON "Mailbox"("active");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Lead_email_key" ON "Lead"("email");`,
  `CREATE INDEX IF NOT EXISTS "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");`,
  `CREATE INDEX IF NOT EXISTS "Lead_importId_idx" ON "Lead"("importId");`,
  `CREATE INDEX IF NOT EXISTS "Lead_company_idx" ON "Lead"("company");`,
  `CREATE INDEX IF NOT EXISTS "LeadNote_leadId_createdAt_idx" ON "LeadNote"("leadId", "createdAt");`,
  `CREATE INDEX IF NOT EXISTS "LeadEvent_leadId_createdAt_idx" ON "LeadEvent"("leadId", "createdAt");`,
  `CREATE INDEX IF NOT EXISTS "Campaign_status_idx" ON "Campaign"("status");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CampaignMailbox_campaignId_mailboxId_key" ON "CampaignMailbox"("campaignId", "mailboxId");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CampaignStep_campaignId_position_key" ON "CampaignStep"("campaignId", "position");`,
  `CREATE INDEX IF NOT EXISTS "CampaignEnrollment_status_nextSendAt_idx" ON "CampaignEnrollment"("status", "nextSendAt");`,
  `CREATE INDEX IF NOT EXISTS "CampaignEnrollment_campaignId_status_idx" ON "CampaignEnrollment"("campaignId", "status");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CampaignEnrollment_campaignId_leadId_key" ON "CampaignEnrollment"("campaignId", "leadId");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CampaignMessage_trackingId_key" ON "CampaignMessage"("trackingId");`,
  `CREATE INDEX IF NOT EXISTS "CampaignMessage_campaignId_sentAt_idx" ON "CampaignMessage"("campaignId", "sentAt");`,
  `CREATE INDEX IF NOT EXISTS "CampaignMessage_messageId_idx" ON "CampaignMessage"("messageId");`,
  `CREATE INDEX IF NOT EXISTS "CampaignMessage_leadId_idx" ON "CampaignMessage"("leadId");`,
  `CREATE INDEX IF NOT EXISTS "CampaignReply_leadId_receivedAt_idx" ON "CampaignReply"("leadId", "receivedAt");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CampaignReply_mailboxId_messageId_key" ON "CampaignReply"("mailboxId", "messageId");`,
  `DO $$ BEGIN
  ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "Lead" ADD CONSTRAINT "Lead_importId_fkey" FOREIGN KEY ("importId") REFERENCES "LeadImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "CampaignMailbox" ADD CONSTRAINT "CampaignMailbox_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "CampaignMailbox" ADD CONSTRAINT "CampaignMailbox_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "CampaignStep" ADD CONSTRAINT "CampaignStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "CampaignEnrollment" ADD CONSTRAINT "CampaignEnrollment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "CampaignEnrollment" ADD CONSTRAINT "CampaignEnrollment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "CampaignEnrollment" ADD CONSTRAINT "CampaignEnrollment_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CampaignEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "CampaignStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "CampaignReply" ADD CONSTRAINT "CampaignReply_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  ALTER TABLE "CampaignReply" ADD CONSTRAINT "CampaignReply_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
];
