// src/lib/paymentLinkCatalog.ts
//
// Assemble le catalogue des liens de paiement tel que le CRM le présente, à
// partir de deux sources :
//   - STRIPE (src/lib/stripe.ts) : les Payment Links actifs, leur URL, le nom du
//     produit et le montant. Source de vérité de ce qui existe.
//   - LE CRM (table PaymentLinkSlot) : quel lien occupe quelle case du plan
//     tarifaire fixe décrit dans src/lib/paymentLinkSlots.ts.
//
// D'où la règle unique qui sépare les deux familles :
//   - un lien ATTRIBUÉ à une case est un lien « classique » ;
//   - tout autre lien actif est « spécial » (créé pour un seul client).
//
// La lecture des attributions est TOLÉRANTE : si la table n'existe pas encore
// (base pas migrée), on renvoie un plan entièrement vide plutôt que de faire
// échouer l'envoi d'un lien de paiement — les liens spéciaux restent utilisables.
import { prisma } from '@/lib/prisma';
import { fetchActivePaymentLinks, type StripePaymentLink } from '@/lib/stripe';
import { PAYMENT_LINK_SLOTS, type PaymentLinkSlotDefinition } from '@/lib/paymentLinkSlots';

/** Le lien Stripe résumé, tel qu'exposé au front. */
export interface CatalogLink {
  id: string;
  url: string;
  /** Nom du produit Stripe. */
  name: string;
  /** Montant + périodicité (« 1 200,00 €/mois »). Vide si Stripe ne l'a pas donné. */
  amountLabel: string;
}

/** Une case du plan, avec le lien qui l'occupe (ou null si elle est vide). */
export interface CatalogSlot extends PaymentLinkSlotDefinition {
  link: CatalogLink | null;
}

export interface PaymentLinkCatalog {
  /** Les 42 cases, toujours dans l'ordre du plan, vides comprises. */
  slots: CatalogSlot[];
  /** Les liens actifs n'occupant aucune case, triés par nom. */
  specials: CatalogLink[];
  /** Tous les liens actifs, triés par nom — alimente les listes déroulantes. */
  allLinks: CatalogLink[];
}

function toCatalogLink(l: StripePaymentLink): CatalogLink {
  return { id: l.id, url: l.url, name: l.productName, amountLabel: l.amountLabel };
}

const byName = (a: CatalogLink, b: CatalogLink) =>
  a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });

/** Lit les attributions. Map vide si la table n'existe pas encore. */
async function loadAssignments(): Promise<Map<string, string>> {
  try {
    const rows = await prisma.paymentLinkSlot.findMany();
    return new Map(rows.map(r => [r.slotKey, r.stripeLinkId]));
  } catch (err) {
    // Base pas encore migrée (db-sync / `npm run db:push`) : plan vide.
    console.warn('PaymentLinkSlot illisible, plan tarifaire non attribué :', (err as Error).message);
    return new Map();
  }
}

/** Le catalogue complet : le plan tarifaire attribué, plus les liens spéciaux. */
export async function getPaymentLinkCatalog(): Promise<PaymentLinkCatalog> {
  const [links, assignments] = await Promise.all([fetchActivePaymentLinks(), loadAssignments()]);

  const byId = new Map(links.map(l => [l.id, toCatalogLink(l)]));

  const slots: CatalogSlot[] = PAYMENT_LINK_SLOTS.map(def => {
    const assignedId = assignments.get(def.slotKey);
    // Un lien attribué puis archivé côté Stripe n'est plus dans `byId` : la case
    // redevient vide, sans qu'on ait à nettoyer la table.
    return { ...def, link: (assignedId && byId.get(assignedId)) || null };
  });

  // « Spécial » = actif mais n'occupant aucune case OCCUPÉE (donc en tenant
  // compte des attributions réellement résolues, pas des lignes orphelines).
  const usedIds = new Set(slots.filter(s => s.link).map(s => s.link!.id));
  const specials = links.filter(l => !usedIds.has(l.id)).map(toCatalogLink).sort(byName);
  const allLinks = links.map(toCatalogLink).sort(byName);

  return { slots, specials, allLinks };
}
