// src/lib/stripe.ts
//
// Lecture des « Payment Links » (liens de paiement) actifs depuis Stripe, pour
// permettre d'envoyer un lien de paiement depuis le CRM (bouton « Envoyer un
// lien de paiement » de la fiche affaire).
//
// Module PUR : aucune dépendance à Neon/Prisma ni au SDK Stripe. On interroge
// directement l'API REST Stripe via `fetch` avec la clé secrète, exactement
// comme demoOrganization.ts / recruitment.ts le font pour Supabase (PostgREST).
// Cela évite d'ajouter une dépendance npm et de casser le build.
//
// Variable d'environnement requise (voir .env.example) :
//   STRIPE_SECRET_KEY   (clé secrète Stripe, sk_live_… ou sk_test_…)

const STRIPE_API = 'https://api.stripe.com/v1';

/** Indique si l'intégration Stripe est configurée. Sinon on no-op silencieusement. */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Lien de paiement Stripe exposé au front (déjà résumé, sans données sensibles). */
export interface StripePaymentLink {
  /** Id du Payment Link (plink_…). */
  id: string;
  /** URL publique du lien de paiement (https://buy.stripe.com/…). */
  url: string;
  /** Libellé lisible : « Nom du produit — 1 200,00 € » (au mieux). */
  label: string;
}

// ---- Types bruts (partiels) renvoyés par l'API Stripe -----------------------
interface StripeProduct {
  id: string;
  name?: string | null;
}
interface StripePrice {
  unit_amount?: number | null;
  currency?: string | null;
  nickname?: string | null;
  recurring?: { interval?: string | null } | null;
  product?: string | StripeProduct | null;
}
interface StripeLineItem {
  description?: string | null;
  quantity?: number | null;
  price?: StripePrice | null;
}
interface StripePaymentLinkRaw {
  id: string;
  active: boolean;
  url: string;
  line_items?: { data?: StripeLineItem[] } | null;
}
interface StripeList<T> {
  data: T[];
  has_more: boolean;
}

/** Formate un montant Stripe (en centimes) selon la devise. */
function formatAmount(unitAmount: number | null | undefined, currency: string | null | undefined): string {
  if (unitAmount == null) return '';
  const cur = (currency || 'eur').toUpperCase();
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur }).format(unitAmount / 100);
  } catch {
    // Devise inconnue d'Intl : repli brut.
    return `${(unitAmount / 100).toFixed(2)} ${cur}`;
  }
}

/** Construit un libellé lisible pour un Payment Link à partir de sa 1re ligne. */
function buildLabel(link: StripePaymentLinkRaw): string {
  const item = link.line_items?.data?.[0];
  const price = item?.price ?? null;
  const product = price?.product;
  const productName =
    product && typeof product === 'object' ? product.name?.trim() : undefined;

  const name = productName || price?.nickname?.trim() || item?.description?.trim() || 'Lien de paiement';
  const amount = formatAmount(price?.unit_amount, price?.currency);
  const interval = price?.recurring?.interval ? `/${price.recurring.interval === 'month' ? 'mois' : price.recurring.interval}` : '';

  return amount ? `${name} — ${amount}${interval}` : name;
}

/** Appel GET Stripe avec la clé secrète. Lève une erreur si non configuré ou HTTP KO. */
async function stripeGet<T>(path: string): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe non configuré (STRIPE_SECRET_KEY manquant)');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(`${STRIPE_API}${path}`, {
      headers: {
        Authorization: `Bearer ${key}`,
        // Version API figée pour un comportement stable dans le temps.
        'Stripe-Version': '2024-06-20',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Appel Stripe « ${path} » échoué (${res.status}) : ${detail}`);
  }
  return (await res.json()) as T;
}

/**
 * Récupère tous les Payment Links ACTIFS de Stripe, résumés pour le front.
 * On développe (`expand`) les lignes de commande et le produit pour construire
 * un libellé lisible. Pagine jusqu'à épuisement (garde-fou à 5 pages / 500 liens).
 * Renvoie [] si l'intégration n'est pas configurée.
 */
export async function fetchActivePaymentLinks(): Promise<StripePaymentLink[]> {
  if (!isStripeConfigured()) return [];

  const out: StripePaymentLink[] = [];
  let startingAfter: string | null = null;
  const MAX_PAGES = 5;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams();
    params.set('active', 'true');
    params.set('limit', '100');
    // Expansions : lignes de commande + prix + produit (≤ 4 niveaux, OK Stripe).
    params.append('expand[]', 'data.line_items');
    params.append('expand[]', 'data.line_items.data.price.product');
    if (startingAfter) params.set('starting_after', startingAfter);

    const list = await stripeGet<StripeList<StripePaymentLinkRaw>>(`/payment_links?${params.toString()}`);
    for (const link of list.data) {
      if (!link.active || !link.url) continue;
      out.push({ id: link.id, url: link.url, label: buildLabel(link) });
    }
    if (!list.has_more || list.data.length === 0) break;
    startingAfter = list.data[list.data.length - 1].id;
  }

  return out;
}

/**
 * Ajoute `?client_reference_id=<ref>` (ou `&…` si l'URL a déjà des paramètres)
 * à un lien de paiement Stripe. Le client_reference_id permet de rattacher le
 * paiement à l'organisation (ou au groupe) côté produit.
 */
export function appendClientReferenceId(url: string, referenceId: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}client_reference_id=${encodeURIComponent(referenceId)}`;
}
