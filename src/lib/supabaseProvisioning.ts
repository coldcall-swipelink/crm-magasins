// src/lib/supabaseProvisioning.ts
//
// Orchestration côté CRM du provisioning de la base produit Supabase quand une
// affaire passe dans la colonne « Démo prévue ».
//
// Ce module lit le Deal dans la base Neon du CRM (via Prisma), gère
// l'idempotence, puis délègue la création des enregistrements Supabase
// (Organization + Organization_to_plan + Recruiter) au module PUR
// demoOrganization.ts (qui ne dépend pas de Neon).
//
// Idempotent : l'id de l'Organization créée est stocké sur le Deal
// (supabaseOrganizationId). Si déjà présent, on ne refait rien.

import { prisma } from '@/lib/prisma';
import {
  createDemoOrganizationRecords,
  createSupportRecruiterRecord,
  isProductSupabaseConfigured,
} from '@/lib/demoOrganization';
import { matchDealOrganization } from '@/lib/recruitment';

export { isProductSupabaseConfigured };

/**
 * Crée Organization + Organization_to_plan + Recruiter dans la base produit
 * Supabase pour une affaire passée en « Démo prévue ».
 *
 * Idempotent : ne fait rien si le deal possède déjà un supabaseOrganizationId
 * ou si l'intégration n'est pas configurée.
 */
export async function provisionDemoOrganization(dealId: string): Promise<void> {
  if (!isProductSupabaseConfigured()) return;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { store: { include: { brand: true } }, column: true },
  });
  if (!deal) return;
  // « Démo prévue » (pipeline Prospection) ou « DEMO PREVUE » (pipeline Closing).
  if (deal.column?.title !== 'Démo prévue' && deal.column?.title !== 'DEMO PREVUE') return;
  if (deal.supabaseOrganizationId) return; // déjà provisionné → on ne refait rien

  await createDemoOrganizationRecords(
    {
      brandName: deal.store.brand?.name,
      storeName: deal.store.name,
      city: deal.store.city,
      contactEmail: deal.dealEmail || null,
      siret: deal.store.siret || null,
    },
    // On mémorise l'id sur le deal dès l'Organization créée : garantit
    // l'idempotence même si le plan ou le recruiter échoue ensuite.
    async (organizationId) => {
      await prisma.deal.update({
        where: { id: deal.id },
        data: { supabaseOrganizationId: organizationId },
      });
    },
  );
}

/**
 * Crée un Recruiter « Support » sur l'Organization du deal dans la base produit
 * Supabase quand une affaire passe en « SMARTLINKÉ » (pipeline Closing).
 *
 * L'Organization n'est PAS créée ici : on réutilise celle rattachée au deal
 * (supabaseOrganizationId, posée en « Démo prévue »). Si elle est absente, on
 * tente de la retrouver par nom (comme l'onglet « Recrutement ») et on la
 * mémorise. Sans organisation résolue, on ne fait rien.
 *
 * Idempotent : `createSupportRecruiterRecord` ne recrée pas un Recruiter
 * Support déjà présent pour ce couple user/organisation.
 */
export async function provisionSmartlinkeSupportRecruiter(dealId: string): Promise<void> {
  if (!isProductSupabaseConfigured()) return;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { store: { include: { brand: true } }, column: true },
  });
  if (!deal) return;
  // « SMARTLINKÉ » (insensible à la casse et aux accents).
  const columnTitle = deal.column?.title ?? '';
  const normalized = columnTitle.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!normalized.includes('smartlink')) return;

  let organizationId = deal.supabaseOrganizationId;
  if (!organizationId) {
    // Pas encore rattaché : on tente une correspondance par nom (enseigne + magasin).
    const match = await matchDealOrganization({
      brandName: deal.store.brand?.name,
      storeName: deal.store.name,
      city: deal.store.city,
    });
    if (match.organizationId) {
      organizationId = match.organizationId;
      await prisma.deal.update({
        where: { id: deal.id },
        data: { supabaseOrganizationId: organizationId },
      });
    }
  }
  if (!organizationId) return; // aucune organisation → rien à faire

  await createSupportRecruiterRecord(organizationId);
}
