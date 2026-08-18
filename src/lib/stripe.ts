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
  /** Libellé lisible complet : « Nom du produit — 1 200,00 €/mois » (au mieux). */
  label: string;
  /** Nom du produit seul, sans le montant (« Abonnement Premium »). */
  productName: string;
  /** Montant seul, périodicité comprise (« 1 200,00 €/mois »). Vide si inconnu. */
  amountLabel: string;
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
  // Stripe décrit une périodicité en DEUX champs : l'unité (`month`) et son
  // multiple (`interval_count`: 3 pour « tous les 3 mois »).
  recurring?: { interval?: string | null; interval_count?: number | null } | null;
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

/** Libellé résolu d'un lien : nom du produit, montant, et la concaténation. */
type LinkLabel = { productName: string; amountLabel: string; label: string };

const FALLBACK_LABEL: LinkLabel = { productName: 'Lien de paiement', amountLabel: '', label: 'Lien de paiement' };

/** Unités de périodicité Stripe, au singulier et au pluriel. */
const INTERVAL_UNITS: Record<string, { one: string; many: string }> = {
  day: { one: 'jour', many: 'jours' },
  week: { one: 'semaine', many: 'semaines' },
  month: { one: 'mois', many: 'mois' },
  year: { one: 'an', many: 'ans' },
};

/**
 * Suffixe de périodicité affichable : « /mois », « /an », mais aussi « /3 mois »
 * ou « /6 mois ».
 *
 * Stripe exprime une périodicité en deux champs — l'unité (`interval`) et son
 * multiple (`interval_count`). Ignorer le second faisait afficher « /mois » à un
 * abonnement facturé tous les 3 mois.
 */
function intervalSuffix(interval: string | null | undefined, count: number | null | undefined): string {
  if (!interval) return '';
  const n = typeof count === 'number' && count > 1 ? count : 1;
  const unit = INTERVAL_UNITS[interval];
  if (!unit) return n > 1 ? `/${n} ${interval}` : `/${interval}`;
  return n > 1 ? `/${n} ${unit.many}` : `/${unit.one}`;
}

/** Nom d'une ligne de commande, quantité comprise si elle dépasse 1. */
function lineItemName(item: StripeLineItem): string {
  const price = item.price ?? null;
  const product = price?.product;
  const name =
    (product && typeof product === 'object' ? product.name?.trim() : undefined)
    || item.description?.trim()
    || price?.nickname?.trim()
    || '';
  if (!name) return '';
  const qty = item.quantity ?? 1;
  return qty > 1 ? `${qty} × ${name}` : name;
}

/**
 * Décrit un lien à partir de TOUTES ses lignes de commande.
 *
 * Un Payment Link n'a pas de nom propre dans l'API Stripe : le dashboard
 * l'étiquette par ses produits. On fait donc pareil, en reprenant chaque ligne
 * (« Abonnement + Frais d'installation ») — ne lire que la première donnait un
 * intitulé qui ne correspondait pas à ce qu'on voit chez Stripe.
 *
 * Le montant est la somme des lignes (prix unitaire × quantité), avec la
 * périodicité complète de la première ligne récurrente — unité ET multiple,
 * pour distinguer « /mois » de « /3 mois ».
 */
function describeLineItems(items: StripeLineItem[]): LinkLabel {
  const names = items.map(lineItemName).filter(Boolean);
  const productName = names.length ? names.join(' + ') : 'Lien de paiement';

  let total = 0;
  let hasAmount = false;
  for (const item of items) {
    const unit = item.price?.unit_amount;
    if (unit != null) { total += unit * (item.quantity ?? 1); hasAmount = true; }
  }
  // Devise et périodicité : celles de la première ligne qui les porte. Un lien
  // mélangeant deux devises n'existe pas côté Stripe, l'ambiguïté est théorique.
  const currency = items.find(i => i.price?.currency)?.price?.currency ?? 'eur';
  const recurring = items.find(i => i.price?.recurring?.interval)?.price?.recurring ?? null;

  const amountLabel = hasAmount
    ? `${formatAmount(total, currency)}${intervalSuffix(recurring?.interval, recurring?.interval_count)}`
    : '';
  return { productName, amountLabel, label: amountLabel ? `${productName} — ${amountLabel}` : productName };
}

/** Pause simple, pour espacer deux tentatives. */
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Erreurs qui méritent une nouvelle tentative : le 429 « rate limit » de Stripe
 * (on interroge un endpoint par lien, on tape vite la limite) et les 5xx, qui
 * sont par nature passagers. Tout le reste (401, 403, 404…) est définitif :
 * réessayer ne ferait que retarder un message d'erreur exact.
 */
const isRetryableStatus = (status: number) => status === 429 || status >= 500;

/** Nombre total de tentatives par requête (1 essai + 3 reprises). */
const MAX_ATTEMPTS = 4;

/** Délai avant reprise : ce que Stripe demande, sinon 400 ms, 800 ms, 1600 ms. */
function retryDelayMs(res: Response | null, attempt: number): number {
  const header = res?.headers.get('retry-after');
  const fromHeader = header ? Number(header) * 1000 : NaN;
  return Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : 400 * 2 ** (attempt - 1);
}

/**
 * Appel GET Stripe avec la clé secrète. Lève une erreur si non configuré ou si
 * la requête échoue définitivement.
 *
 * Reprend automatiquement sur 429 / 5xx / coupure réseau : sans cela, une seule
 * requête étranglée par le rate limit suffisait à afficher un libellé générique
 * à la place du vrai nom du produit, de façon intermittente.
 */
async function stripeGet<T>(path: string): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe non configuré (STRIPE_SECRET_KEY manquant)');

  let lastError: Error = new Error('Stripe : échec inconnu');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
    } catch (networkErr) {
      // Coupure réseau ou dépassement des 20 s : passager, on retente.
      lastError = new Error(`Stripe injoignable : ${(networkErr as Error).message}`);
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(retryDelayMs(null, attempt));
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) return (await res.json()) as T;

    const raw = await res.text();
    // Stripe renvoie un JSON { error: { message, code, type } } : on en extrait
    // un message lisible (ex. permissions manquantes sur une clé restreinte).
    let message = raw;
    try {
      const parsed = JSON.parse(raw);
      message = parsed?.error?.message || raw;
    } catch { /* corps non-JSON : on garde le texte brut */ }
    const hint =
      res.status === 401 ? ' (clé invalide ou absente)' :
      res.status === 403 ? ' (clé restreinte : autorisez la lecture de Payment Links, Products et Prices)' :
      res.status === 429 ? ' (trop de requêtes)' :
      '';
    lastError = new Error(`Stripe ${res.status}${hint} : ${message}`);

    if (!isRetryableStatus(res.status) || attempt === MAX_ATTEMPTS) throw lastError;
    await sleep(retryDelayMs(res, attempt));
  }

  throw lastError;
}

/**
 * Exécute `task` sur chaque élément, `limit` en vol à la fois.
 *
 * Indispensable ici : un Promise.all sur tous les liens lançait autant de
 * requêtes simultanées qu'il y a de liens de paiement, ce qui déclenchait le
 * rate limit de Stripe. Les résultats gardent l'ordre des entrées.
 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Cache mémoire des libellés, par lien.
 *
 * Le produit et le tarif d'un lien de paiement ne changent quasiment jamais,
 * alors que le CRM recharge le catalogue à chaque ouverture du composer et à
 * chaque enregistrement du plan tarifaire. Sans ce cache, chaque chargement
 * relançait un appel par lien vers Stripe — la cause même du rate limit.
 *
 * Le cache vit dans le processus : chaque instance serverless a le sien, et il
 * disparaît au redéploiement. C'est suffisant, et cela borne la péremption.
 */
const labelCache = new Map<string, { value: LinkLabel; at: number }>();
const LABEL_TTL_MS = 10 * 60_000;

/**
 * Vide le cache des libellés, pour forcer une relecture chez Stripe. Utilisé par
 * le bouton « Rafraîchir » du paramétrage, après un renommage de produit.
 */
export function clearPaymentLinkLabelCache(): void {
  labelCache.clear();
}

/** Nombre d'appels « line items » simultanés. Volontairement bas : voir mapWithConcurrency. */
const LABEL_CONCURRENCY = 6;

/**
 * Récupère le libellé (nom du produit + montant) d'un Payment Link via ses line
 * items. On utilise l'endpoint dédié `/payment_links/{id}/line_items` (qui,
 * contrairement au « list » des payment links, autorise l'expansion de
 * line_items) avec expansion du produit pour afficher son nom.
 *
 * En cas d'échec on renvoie, dans l'ordre : la dernière valeur connue même
 * périmée, puis un libellé générique. Afficher un nom un peu ancien vaut
 * toujours mieux qu'afficher « Lien de paiement » à la place du vrai produit.
 */
async function fetchPaymentLinkLabel(id: string): Promise<LinkLabel> {
  const cached = labelCache.get(id);
  if (cached && Date.now() - cached.at < LABEL_TTL_MS) return cached.value;

  try {
    const params = new URLSearchParams();
    // Tous les line items : un lien peut en porter plusieurs (abonnement + frais
    // d'installation, par exemple) et n'en montrer qu'un donnerait un intitulé
    // qui ne correspond pas à ce que le client verra.
    params.set('limit', '100');
    params.append('expand[]', 'data.price.product');
    const res = await stripeGet<StripeList<StripeLineItem>>(
      `/payment_links/${encodeURIComponent(id)}/line_items?${params.toString()}`,
    );
    const value = describeLineItems(res.data || []);
    labelCache.set(id, { value, at: Date.now() });
    return value;
  } catch (err) {
    console.warn(`Libellé Stripe indisponible pour ${id} :`, (err as Error).message);
    return cached?.value ?? FALLBACK_LABEL;
  }
}

/**
 * Récupère tous les Payment Links ACTIFS de Stripe, résumés pour le front.
 *
 * En deux temps, pour rester robuste :
 *   1. Liste des liens actifs SANS expansion — l'expansion de `line_items`
 *      n'est pas autorisée sur les endpoints « list » de Stripe. Ne requiert
 *      que la permission « Payment Links » en lecture.
 *   2. Enrichissement du libellé par lien via l'endpoint `line_items`, en
 *      concurrence bornée et avec cache (voir fetchPaymentLinkLabel).
 *
 * Pagine jusqu'à épuisement (garde-fou à 5 pages / 500 liens). Renvoie [] si
 * l'intégration n'est pas configurée.
 */
export async function fetchActivePaymentLinks(): Promise<StripePaymentLink[]> {
  if (!isStripeConfigured()) return [];

  // 1. Liste des liens actifs (sans expand).
  const active: StripePaymentLinkRaw[] = [];
  let startingAfter: string | null = null;
  const MAX_PAGES = 5;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams();
    params.set('active', 'true');
    params.set('limit', '100');
    if (startingAfter) params.set('starting_after', startingAfter);

    const list = await stripeGet<StripeList<StripePaymentLinkRaw>>(`/payment_links?${params.toString()}`);
    for (const link of list.data) {
      if (link.active && link.url) active.push(link);
    }
    if (!list.has_more || list.data.length === 0) break;
    startingAfter = list.data[list.data.length - 1].id;
  }

  // 2. Libellés, au maximum LABEL_CONCURRENCY appels en vol.
  const labels = await mapWithConcurrency(active, LABEL_CONCURRENCY, l => fetchPaymentLinkLabel(l.id));

  return active.map((l, i) => ({ id: l.id, url: l.url, ...labels[i] }));
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
