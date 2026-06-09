import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Route de synchronisation de schéma EXÉCUTÉE PAR LE RUNTIME (qui, lui, joint la
// base — contrairement au build). Elle applique uniquement des ajouts de
// colonnes en `ADD COLUMN IF NOT EXISTS` : les colonnes déjà présentes sont
// ignorées, aucune suppression, aucune perte de données.
//
// À usage ponctuel : protégée par un token, et à retirer une fois la base à jour.
export const dynamic = 'force-dynamic';

const TOKEN = 'sync-crm-2026';

const STATEMENTS: string[] = [
  "ALTER TABLE \"Brand\" ADD COLUMN IF NOT EXISTS \"id\" TEXT;",
  "ALTER TABLE \"Brand\" ADD COLUMN IF NOT EXISTS \"name\" TEXT;",
  "ALTER TABLE \"Brand\" ADD COLUMN IF NOT EXISTS \"color\" TEXT NOT NULL DEFAULT '#6366f1';",
  "ALTER TABLE \"Brand\" ADD COLUMN IF NOT EXISTS \"createdAt\" TIMESTAMP(3);",
  "ALTER TABLE \"Brand\" ADD COLUMN IF NOT EXISTS \"updatedAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;",
  "ALTER TABLE \"Store\" ADD COLUMN IF NOT EXISTS \"id\" TEXT;",
  "ALTER TABLE \"Store\" ADD COLUMN IF NOT EXISTS \"brandId\" TEXT;",
  "ALTER TABLE \"Store\" ADD COLUMN IF NOT EXISTS \"name\" TEXT;",
  "ALTER TABLE \"Store\" ADD COLUMN IF NOT EXISTS \"normalizedName\" TEXT;",
  "ALTER TABLE \"Store\" ADD COLUMN IF NOT EXISTS \"city\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"Store\" ADD COLUMN IF NOT EXISTS \"postalCode\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"Store\" ADD COLUMN IF NOT EXISTS \"department\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"Store\" ADD COLUMN IF NOT EXISTS \"address\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"Store\" ADD COLUMN IF NOT EXISTS \"phone\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"Store\" ADD COLUMN IF NOT EXISTS \"email\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"Store\" ADD COLUMN IF NOT EXISTS \"siret\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"Store\" ADD COLUMN IF NOT EXISTS \"externalId\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"Store\" ADD COLUMN IF NOT EXISTS \"deduplicationKey\" TEXT;",
  "ALTER TABLE \"Store\" ADD COLUMN IF NOT EXISTS \"createdAt\" TIMESTAMP(3);",
  "ALTER TABLE \"Store\" ADD COLUMN IF NOT EXISTS \"updatedAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;",
  "ALTER TABLE \"Collaborator\" ADD COLUMN IF NOT EXISTS \"id\" TEXT;",
  "ALTER TABLE \"Collaborator\" ADD COLUMN IF NOT EXISTS \"name\" TEXT;",
  "ALTER TABLE \"Collaborator\" ADD COLUMN IF NOT EXISTS \"email\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"Collaborator\" ADD COLUMN IF NOT EXISTS \"color\" TEXT NOT NULL DEFAULT '#6366f1';",
  "ALTER TABLE \"Collaborator\" ADD COLUMN IF NOT EXISTS \"createdAt\" TIMESTAMP(3);",
  "ALTER TABLE \"Collaborator\" ADD COLUMN IF NOT EXISTS \"updatedAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;",
  "ALTER TABLE \"Pipeline\" ADD COLUMN IF NOT EXISTS \"id\" TEXT;",
  "ALTER TABLE \"Pipeline\" ADD COLUMN IF NOT EXISTS \"name\" TEXT;",
  "ALTER TABLE \"Pipeline\" ADD COLUMN IF NOT EXISTS \"position\" INTEGER NOT NULL DEFAULT 0;",
  "ALTER TABLE \"Pipeline\" ADD COLUMN IF NOT EXISTS \"color\" TEXT NOT NULL DEFAULT '#6366f1';",
  "ALTER TABLE \"Pipeline\" ADD COLUMN IF NOT EXISTS \"createdAt\" TIMESTAMP(3);",
  "ALTER TABLE \"Pipeline\" ADD COLUMN IF NOT EXISTS \"updatedAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;",
  "ALTER TABLE \"PipelineColumn\" ADD COLUMN IF NOT EXISTS \"id\" TEXT;",
  "ALTER TABLE \"PipelineColumn\" ADD COLUMN IF NOT EXISTS \"pipelineId\" TEXT;",
  "ALTER TABLE \"PipelineColumn\" ADD COLUMN IF NOT EXISTS \"title\" TEXT;",
  "ALTER TABLE \"PipelineColumn\" ADD COLUMN IF NOT EXISTS \"position\" INTEGER;",
  "ALTER TABLE \"PipelineColumn\" ADD COLUMN IF NOT EXISTS \"color\" TEXT NOT NULL DEFAULT '#6366f1';",
  "ALTER TABLE \"PipelineColumn\" ADD COLUMN IF NOT EXISTS \"isDefault\" BOOLEAN NOT NULL DEFAULT false;",
  "ALTER TABLE \"PipelineColumn\" ADD COLUMN IF NOT EXISTS \"createdAt\" TIMESTAMP(3);",
  "ALTER TABLE \"PipelineColumn\" ADD COLUMN IF NOT EXISTS \"updatedAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"id\" TEXT;",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"pipelineId\" TEXT;",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"storeId\" TEXT;",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"columnId\" TEXT;",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"previousColumnId\" TEXT;",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"priority\" TEXT NOT NULL DEFAULT 'normale';",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"position\" INTEGER NOT NULL DEFAULT 0;",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"isNewFromLastImport\" BOOLEAN NOT NULL DEFAULT false;",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"hasNewOfferFromLastImport\" BOOLEAN NOT NULL DEFAULT false;",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"isPresentInLastImport\" BOOLEAN NOT NULL DEFAULT true;",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"movedToCallAt\" TIMESTAMP(3);",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"lastImportAt\" TIMESTAMP(3);",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"directeur\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"contactCalling\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"dealEmail\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"contactCivilite\" TEXT NOT NULL DEFAULT 'Monsieur';",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"contactLastName\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"dealValue\" DOUBLE PRECISION;",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"demoDate\" TIMESTAMP(3);",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"collaboratorId\" TEXT;",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"createdAt\" TIMESTAMP(3);",
  "ALTER TABLE \"Deal\" ADD COLUMN IF NOT EXISTS \"updatedAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"id\" TEXT;",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"dealId\" TEXT;",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"storeId\" TEXT;",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"importBatchId\" TEXT;",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"externalOfferId\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"title\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"jobTitle\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"contractType\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"salary\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"source\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"url\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"publishedAt\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"fingerprint\" TEXT;",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"firstSeenAt\" TIMESTAMP(3);",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"lastSeenAt\" TIMESTAMP(3);",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"status\" TEXT NOT NULL DEFAULT 'active';",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"createdAt\" TIMESTAMP(3);",
  "ALTER TABLE \"JobOffer\" ADD COLUMN IF NOT EXISTS \"updatedAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;",
  "ALTER TABLE \"ImportBatch\" ADD COLUMN IF NOT EXISTS \"id\" TEXT;",
  "ALTER TABLE \"ImportBatch\" ADD COLUMN IF NOT EXISTS \"fileName\" TEXT;",
  "ALTER TABLE \"ImportBatch\" ADD COLUMN IF NOT EXISTS \"importedAt\" TIMESTAMP(3);",
  "ALTER TABLE \"ImportBatch\" ADD COLUMN IF NOT EXISTS \"totalRows\" INTEGER NOT NULL DEFAULT 0;",
  "ALTER TABLE \"ImportBatch\" ADD COLUMN IF NOT EXISTS \"createdDeals\" INTEGER NOT NULL DEFAULT 0;",
  "ALTER TABLE \"ImportBatch\" ADD COLUMN IF NOT EXISTS \"updatedDeals\" INTEGER NOT NULL DEFAULT 0;",
  "ALTER TABLE \"ImportBatch\" ADD COLUMN IF NOT EXISTS \"newOffers\" INTEGER NOT NULL DEFAULT 0;",
  "ALTER TABLE \"ImportBatch\" ADD COLUMN IF NOT EXISTS \"movedToCall\" INTEGER NOT NULL DEFAULT 0;",
  "ALTER TABLE \"ImportBatch\" ADD COLUMN IF NOT EXISTS \"disappearedOffers\" INTEGER NOT NULL DEFAULT 0;",
  "ALTER TABLE \"ImportBatch\" ADD COLUMN IF NOT EXISTS \"errorCount\" INTEGER NOT NULL DEFAULT 0;",
  "ALTER TABLE \"ImportBatch\" ADD COLUMN IF NOT EXISTS \"createdAt\" TIMESTAMP(3);",
  "ALTER TABLE \"ImportRow\" ADD COLUMN IF NOT EXISTS \"id\" TEXT;",
  "ALTER TABLE \"ImportRow\" ADD COLUMN IF NOT EXISTS \"importBatchId\" TEXT;",
  "ALTER TABLE \"ImportRow\" ADD COLUMN IF NOT EXISTS \"rowNumber\" INTEGER;",
  "ALTER TABLE \"ImportRow\" ADD COLUMN IF NOT EXISTS \"rawData\" JSONB;",
  "ALTER TABLE \"ImportRow\" ADD COLUMN IF NOT EXISTS \"status\" TEXT NOT NULL DEFAULT 'ok';",
  "ALTER TABLE \"ImportRow\" ADD COLUMN IF NOT EXISTS \"errorMessage\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"ImportRow\" ADD COLUMN IF NOT EXISTS \"storeId\" TEXT;",
  "ALTER TABLE \"ImportRow\" ADD COLUMN IF NOT EXISTS \"dealId\" TEXT;",
  "ALTER TABLE \"ImportRow\" ADD COLUMN IF NOT EXISTS \"createdAt\" TIMESTAMP(3);",
  "ALTER TABLE \"Action\" ADD COLUMN IF NOT EXISTS \"id\" TEXT;",
  "ALTER TABLE \"Action\" ADD COLUMN IF NOT EXISTS \"dealId\" TEXT;",
  "ALTER TABLE \"Action\" ADD COLUMN IF NOT EXISTS \"title\" TEXT;",
  "ALTER TABLE \"Action\" ADD COLUMN IF NOT EXISTS \"type\" TEXT NOT NULL DEFAULT 'Appeler';",
  "ALTER TABLE \"Action\" ADD COLUMN IF NOT EXISTS \"dueDate\" TIMESTAMPTZ;",
  "ALTER TABLE \"Action\" ADD COLUMN IF NOT EXISTS \"dueTime\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"Action\" ADD COLUMN IF NOT EXISTS \"status\" TEXT NOT NULL DEFAULT 'todo';",
  "ALTER TABLE \"Action\" ADD COLUMN IF NOT EXISTS \"priority\" TEXT NOT NULL DEFAULT 'normale';",
  "ALTER TABLE \"Action\" ADD COLUMN IF NOT EXISTS \"note\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"Action\" ADD COLUMN IF NOT EXISTS \"completedAt\" TIMESTAMP(3);",
  "ALTER TABLE \"Action\" ADD COLUMN IF NOT EXISTS \"createdAt\" TIMESTAMP(3);",
  "ALTER TABLE \"Action\" ADD COLUMN IF NOT EXISTS \"updatedAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;",
  "ALTER TABLE \"Note\" ADD COLUMN IF NOT EXISTS \"id\" TEXT;",
  "ALTER TABLE \"Note\" ADD COLUMN IF NOT EXISTS \"dealId\" TEXT;",
  "ALTER TABLE \"Note\" ADD COLUMN IF NOT EXISTS \"content\" TEXT;",
  "ALTER TABLE \"Note\" ADD COLUMN IF NOT EXISTS \"createdAt\" TIMESTAMP(3);",
  "ALTER TABLE \"Note\" ADD COLUMN IF NOT EXISTS \"updatedAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;",
  "ALTER TABLE \"EmailTemplate\" ADD COLUMN IF NOT EXISTS \"id\" TEXT;",
  "ALTER TABLE \"EmailTemplate\" ADD COLUMN IF NOT EXISTS \"name\" TEXT;",
  "ALTER TABLE \"EmailTemplate\" ADD COLUMN IF NOT EXISTS \"subject\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"EmailTemplate\" ADD COLUMN IF NOT EXISTS \"body\" TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE \"EmailTemplate\" ADD COLUMN IF NOT EXISTS \"createdAt\" TIMESTAMP(3);",
  "ALTER TABLE \"EmailTemplate\" ADD COLUMN IF NOT EXISTS \"updatedAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;",
  "ALTER TABLE \"EmailLog\" ADD COLUMN IF NOT EXISTS \"id\" TEXT;",
  "ALTER TABLE \"EmailLog\" ADD COLUMN IF NOT EXISTS \"dealId\" TEXT;",
  "ALTER TABLE \"EmailLog\" ADD COLUMN IF NOT EXISTS \"templateId\" TEXT;",
  "ALTER TABLE \"EmailLog\" ADD COLUMN IF NOT EXISTS \"to\" TEXT;",
  "ALTER TABLE \"EmailLog\" ADD COLUMN IF NOT EXISTS \"subject\" TEXT;",
  "ALTER TABLE \"EmailLog\" ADD COLUMN IF NOT EXISTS \"body\" TEXT;",
  "ALTER TABLE \"EmailLog\" ADD COLUMN IF NOT EXISTS \"status\" TEXT NOT NULL DEFAULT 'sent';",
  "ALTER TABLE \"EmailLog\" ADD COLUMN IF NOT EXISTS \"resendId\" TEXT;",
  "ALTER TABLE \"EmailLog\" ADD COLUMN IF NOT EXISTS \"openedAt\" TIMESTAMP(3);",
  "ALTER TABLE \"EmailLog\" ADD COLUMN IF NOT EXISTS \"sentAt\" TIMESTAMP(3);",
  "ALTER TABLE \"EmailLog\" ADD COLUMN IF NOT EXISTS \"createdAt\" TIMESTAMP(3);"
];

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== TOKEN) {
    return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  }
  const applied: string[] = [];
  const errors: { sql: string; error: string }[] = [];
  for (const sql of STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(sql);
      applied.push(sql);
    } catch (e) {
      errors.push({ sql, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({
    ok: errors.length === 0,
    appliedCount: applied.length,
    errorCount: errors.length,
    errors,
  });
}
