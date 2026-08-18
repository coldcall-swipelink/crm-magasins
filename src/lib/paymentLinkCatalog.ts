// src/lib/paymentLinkCatalog.ts
//
// Catalogue des liens de paiement tel que le CRM doit le présenter.
//
// Deux sources, fusionnées ici une bonne fois pour toutes :
//   - STRIPE (src/lib/stripe.ts) : les liens actifs, leur URL, le produit et le
//     montant. C'est la source de vérité de ce qui existe.
//   - LE CRM (table PaymentLinkConfig) : la mise en forme choisie dans les
//     Paramètres — catégorie « classique » / « spécial », libellé personnalisé,
//     ordre manuel, masquage.
//
// Règles de fusion, pensées pour qu'un lien créé sur Stripe n'ait JAMAIS besoin
// d'une intervention avant de pouvoir être envoyé :
//   - un lien sans ligne de config est « spécial », non masqué, position 0 ;
//   - un libellé personnalisé vide retombe sur le nom du produit Stripe ;
//   - une ligne de config qui ne correspond à aucun lien actif est ignorée
//     (lien archivé côté Stripe) — on ne la supprime pas pour autant, au cas où
//     le lien serait réactivé.
//
// La lecture de la config est TOLÉRANTE : si la table n'existe pas encore (base
// pas migrée), on retombe sur « tout est spécial » plutôt que de casser l'envoi
// de liens de paiement.
import { prisma } from '@/lib/prisma';
import { fetchActivePaymentLinks } from '@/lib/stripe';

/** Catégories de présentation. Stockées telles quelles en base. */
export type PaymentLinkCategory = 'classique' | 'special';

export const PAYMENT_LINK_CATEGORIES: PaymentLinkCategory[] = ['classique', 'special'];

/** Un lien de paiement, prêt à afficher. */
export interface PaymentLinkEntry {
  /** Id du Payment Link Stripe (plink_…). */
  id: string;
  /** URL publique Stripe, SANS client_reference_id (ajouté par l'appelant). */
  url: string;
  /** Libellé affiché : personnalisation CRM si présente, sinon nom du produit. */
  name: string;
  /** Nom du produit tel qu'il est sur Stripe (affiché en Paramètres). */
  stripeName: string;
  /** Libellé personnalisé saisi dans le CRM ('' si aucun). */
  displayName: string;
  /** Montant + périodicité (« 1 200,00 €/mois »). Vide si Stripe ne l'a pas donné. */
  amountLabel: string;
  category: PaymentLinkCategory;
  position: number;
  hidden: boolean;
  /** false = ce lien n'a encore jamais été paramétré dans le CRM. */
  configured: boolean;
}

/** Normalise une catégorie venue de la base ou d'une requête HTTP. */
export function normalizeCategory(value: unknown): PaymentLinkCategory {
  return value === 'classique' ? 'classique' : 'special';
}

/**
 * Ordre d'affichage : la position manuelle d'abord, puis le libellé (pour que
 * les liens jamais paramétrés — tous en position 0 — restent alphabétiques et
 * donc stables d'un chargement à l'autre, l'ordre de l'API Stripe ne l'étant pas).
 */
export function comparePaymentLinks(a: PaymentLinkEntry, b: PaymentLinkEntry): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
}

/** Lit les lignes de config. Renvoie une map vide si la table n'existe pas encore. */
async function loadConfigs(): Promise<Map<string, { category: PaymentLinkCategory; displayName: string; position: number; hidden: boolean }>> {
  const map = new Map<string, { category: PaymentLinkCategory; displayName: string; position: number; hidden: boolean }>();
  try {
    const rows = await prisma.paymentLinkConfig.findMany();
    for (const r of rows) {
      map.set(r.stripeLinkId, {
        category: normalizeCategory(r.category),
        displayName: r.displayName || '',
        position: r.position,
        hidden: r.hidden,
      });
    }
  } catch (err) {
    // Base pas encore migrée (`npm run db:push`) : on continue sans config.
    console.warn('PaymentLinkConfig illisible, catalogue non paramétré :', (err as Error).message);
  }
  return map;
}

/**
 * Catalogue complet, trié, liens masqués COMPRIS (le drapeau `hidden` est
 * renvoyé tel quel). L'écran de paramétrage veut tout voir ; le sélecteur de la
 * fiche affaire filtre lui-même — voir getVisiblePaymentLinks.
 */
export async function getPaymentLinkCatalog(): Promise<PaymentLinkEntry[]> {
  const [links, configs] = await Promise.all([fetchActivePaymentLinks(), loadConfigs()]);

  return links
    .map<PaymentLinkEntry>(link => {
      const cfg = configs.get(link.id);
      const displayName = cfg?.displayName || '';
      return {
        id: link.id,
        url: link.url,
        name: displayName || link.productName,
        stripeName: link.productName,
        displayName,
        amountLabel: link.amountLabel,
        category: cfg?.category ?? 'special',
        position: cfg?.position ?? 0,
        hidden: cfg?.hidden ?? false,
        configured: Boolean(cfg),
      };
    })
    .sort(comparePaymentLinks);
}

/** Catalogue destiné au sélecteur d'une affaire : sans les liens masqués. */
export async function getVisiblePaymentLinks(): Promise<PaymentLinkEntry[]> {
  return (await getPaymentLinkCatalog()).filter(l => !l.hidden);
}
