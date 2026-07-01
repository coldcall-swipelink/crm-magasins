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
  isProductSupabaseConfigured,
} from '@/lib/demoOrganization';

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
 * Crée manuellement (bouton « Créer l'Organization dans Supabase ») l'Organization
 * produit pour une affaire qui n'en a pas encore, avec la MÊME logique que le
 * passage en « Démo prévue » (Organization + plan + Recruiter, nom = enseigne +
 * nom du magasin, logo déduit de l'enseigne).
 *
 * Contrairement à provisionDemoOrganization, ne dépend PAS de la colonne du deal
 * et remonte les erreurs (plutôt que de no-op) afin que l'appelant HTTP puisse
 * les afficher. Reste idempotent : refuse si une Organization est déjà rattachée.
 */
export async function createOrganizationForDeal(
  dealId: string,
): Promise<{ organizationId: string; organizationName: string }> {
  if (!isProductSupabaseConfigured()) {
    throw new Error('Intégration Supabase produit non configurée');
  }

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { store: { include: { brand: true } } },
  });
  if (!deal) throw new Error('Affaire non trouvée');
  if (deal.supabaseOrganizationId) {
    throw new Error('Une organisation est déjà rattachée à cette affaire');
  }

  return createDemoOrganizationRecords(
    {
      brandName: deal.store.brand?.name,
      storeName: deal.store.name,
      city: deal.store.city,
    },
    async (organizationId) => {
      await prisma.deal.update({
        where: { id: deal.id },
        data: { supabaseOrganizationId: organizationId },
      });
    },
  );
}
