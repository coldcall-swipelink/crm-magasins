// src/lib/offerNotifications.ts
//
// Relevé (LECTURE SEULE) des offres créées côté produit (Supabase) par les
// Organizations rattachées aux affaires du CRM, et matérialisation dans la table
// OfferNotification (base CRM). Alimente trois usages :
//   - trace « Nouvelle offre créée : … » dans l'onglet Activité du deal,
//   - point bleu sur la carte d'affaire (offre non acquittée),
//   - centre de notifications du pipeline.
//
// Rien n'est jamais écrit dans Supabase : on lit la table Offer via PostgREST
// (fetchOffersForOrganizations) et on n'écrit que dans la base CRM.
//
// Ligne de base : au tout premier relevé d'une affaire (Deal.offersSyncedAt null),
// les offres déjà présentes sont enregistrées comme « lues » (pré-existantes).
// Seules les offres apparaissant lors des relevés suivants sont « non lues » et
// déclenchent point bleu / notification.

import { prisma } from '@/lib/prisma';
import { isProductSupabaseConfigured } from '@/lib/demoOrganization';
import { fetchOffersForOrganizations } from '@/lib/recruitment';

/**
 * Relève les offres produit des affaires (toutes, ou une seule si `dealId`) et
 * insère dans OfferNotification celles pas encore connues. Idempotent.
 *
 * No-op silencieux si l'intégration Supabase n'est pas configurée, ou si la
 * table OfferNotification / la colonne offersSyncedAt n'existent pas encore
 * (avant exécution de db-sync).
 */
export async function syncOfferNotifications(dealId?: string): Promise<void> {
  if (!isProductSupabaseConfigured()) return;

  // Affaires + leurs organisations produit rattachées (primaire + manuelles).
  let deals: {
    id: string;
    offersSyncedAt: Date | null;
    supabaseOrganizationId: string | null;
    organizationLinks: { organizationId: string }[];
  }[];
  try {
    deals = await prisma.deal.findMany({
      where: dealId ? { id: dealId } : {},
      select: {
        id: true,
        offersSyncedAt: true,
        supabaseOrganizationId: true,
        organizationLinks: { select: { organizationId: true } },
      },
    });
  } catch {
    // Colonne/table manquante (avant db-sync) : on reste silencieux.
    return;
  }

  // Organisations rattachées par affaire + set global d'org à interroger.
  const allOrgIds = new Set<string>();
  const dealOrgs = deals
    .map((d) => {
      const ids = new Set<string>();
      if (d.supabaseOrganizationId) ids.add(d.supabaseOrganizationId);
      for (const l of d.organizationLinks) ids.add(l.organizationId);
      ids.forEach((i) => allOrgIds.add(i));
      return { dealId: d.id, isFirstSync: d.offersSyncedAt == null, orgIds: Array.from(ids) };
    })
    .filter((d) => d.orgIds.length > 0);

  // Aucune organisation rattachée nulle part : rien à relever. On ne pose pas de
  // ligne de base ici — elle sera posée au premier relevé où l'affaire aura une
  // organisation, pour acquitter correctement ses offres pré-existantes.
  if (allOrgIds.size === 0) return;

  // Offres de toutes les organisations concernées (une lecture Supabase groupée).
  const offers = await fetchOffersForOrganizations(Array.from(allOrgIds));
  const offersByOrg = new Map<string, typeof offers>();
  for (const o of offers) {
    const list = offersByOrg.get(o.organization_id) ?? [];
    list.push(o);
    offersByOrg.set(o.organization_id, list);
  }

  // Offres déjà connues par affaire (une seule requête).
  const dealIds = dealOrgs.map((d) => d.dealId);
  let existing: { dealId: string; offerId: string }[] = [];
  try {
    existing = await prisma.offerNotification.findMany({
      where: { dealId: { in: dealIds } },
      select: { dealId: true, offerId: true },
    });
  } catch {
    return; // table manquante avant db-sync
  }
  const existingByDeal = new Map<string, Set<string>>();
  for (const e of existing) {
    const set = existingByDeal.get(e.dealId) ?? new Set<string>();
    set.add(e.offerId);
    existingByDeal.set(e.dealId, set);
  }

  const now = new Date();
  const toCreate: {
    dealId: string;
    organizationId: string;
    offerId: string;
    offerTitle: string;
    offerCreatedAt: Date;
    isRead: boolean;
  }[] = [];

  for (const d of dealOrgs) {
    const known = existingByDeal.get(d.dealId) ?? new Set<string>();
    const seen = new Set<string>(); // dédoublonne une offre partagée entre orgs
    for (const orgId of d.orgIds) {
      for (const o of offersByOrg.get(orgId) ?? []) {
        if (known.has(o.id) || seen.has(o.id)) continue;
        seen.add(o.id);
        toCreate.push({
          dealId: d.dealId,
          organizationId: orgId,
          offerId: o.id,
          offerTitle: (o.title ?? '').trim(),
          offerCreatedAt: o.created_at ? new Date(o.created_at) : now,
          // Premier relevé : offres pré-existantes acquittées d'office.
          isRead: d.isFirstSync,
        });
      }
    }
  }

  if (toCreate.length) {
    try {
      await prisma.offerNotification.createMany({ data: toCreate, skipDuplicates: true });
    } catch (err) {
      console.error('OfferNotification createMany error:', err);
    }
  }

  const firstSyncIds = dealOrgs.filter((d) => d.isFirstSync).map((d) => d.dealId);
  if (firstSyncIds.length) {
    await prisma.deal.updateMany({ where: { id: { in: firstSyncIds } }, data: { offersSyncedAt: now } });
  }
}
