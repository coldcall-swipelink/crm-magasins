// src/lib/payments.ts
//
// Génère l'échéancier des paiements d'un abonnement à partir de sa date de
// closing, selon le type d'abonnement et la cadence de paiement (comptant /
// mensuel). Utilisé par l'onglet « Paiements » (prochains paiements à venir).
//
// Règles métier (récapitulatif) :
//  - Paiement COMPTANT (quel que soit le type) : Valeur × 12, chaque année.
//  - Types « multidiffusion » et « 10 crédit par an » : toujours au comptant,
//    même si la cadence choisie est « mensuel ».
//  - Paiement MENSUEL :
//      · « N crédit par mois »  → Valeur, chaque mois.
//      · « N crédit par an »    → Valeur × (12 / N), tous les (12 / N) mois,
//        lorsque 12 / N est entier (1, 2, 3, 4, 6, 12 crédits/an). Sinon, repli
//        au comptant. Exemples issus des règles :
//          3 crédit/an → Valeur × 4 tous les 4 mois
//          4 crédit/an → Valeur × 3 tous les 3 mois
//          6 crédit/an → Valeur × 2 tous les 2 mois
//          2 crédit/an → Valeur × 6 tous les 6 mois
//          1 crédit/an → Valeur × 12 tous les 12 mois

import { addMonths } from '@/lib/utils';

export interface Installment {
  /** Montant d'une échéance. */
  amount: number;
  /** Périodicité entre deux échéances, en mois. */
  intervalMonths: number;
}

/** Normalise un libellé de type : minuscules, sans accents, espaces réduits. */
function normalizeType(t: string): string {
  return (t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ParsedType {
  /** Nombre de crédits (0 si non trouvé). */
  n: number;
  /** Période du crédit : « mois », « an » ou null si indéterminée. */
  period: 'mois' | 'an' | null;
  /** true pour un abonnement « multidiffusion ». */
  multidiffusion: boolean;
}

/** Extrait le nombre de crédits et leur période d'un libellé de type. */
function parseType(normalized: string): ParsedType {
  const multidiffusion = normalized.includes('multidiffusion');
  const num = normalized.match(/(\d+)/);
  const n = num ? Number(num[1]) : 0;
  let period: 'mois' | 'an' | null = null;
  // « par mois » prime sur « par an » (le mot « mois » est sans ambiguïté).
  if (/\bmois\b/.test(normalized)) period = 'mois';
  else if (/\ban(s|nee|nees)?\b/.test(normalized)) period = 'an';
  return { n, period, multidiffusion };
}

/**
 * Calcule le montant et la périodicité d'une échéance pour un abonnement.
 * Renvoie null si le calcul est impossible (valeur absente).
 */
export function computeInstallment(
  subscriptionType: string,
  paymentTiming: string,
  value: number | null | undefined,
): Installment | null {
  if (value == null || !isFinite(value)) return null;

  const parsed = parseType(normalizeType(subscriptionType));
  const comptant: Installment = { amount: value * 12, intervalMonths: 12 };

  // Multidiffusion et « 10 crédit par an » sont toujours facturés au comptant,
  // quelle que soit la cadence sélectionnée.
  const alwaysComptant = parsed.multidiffusion || (parsed.period === 'an' && parsed.n === 10);
  if (paymentTiming !== 'mensuel' || alwaysComptant) return comptant;

  // --- Cadence mensuelle ---
  if (parsed.period === 'mois') {
    // « N crédit par mois » → la Valeur est retranscrite chaque mois.
    return { amount: value, intervalMonths: 1 };
  }
  if (parsed.period === 'an' && parsed.n > 0 && 12 % parsed.n === 0) {
    // « N crédit par an » → Valeur × (12/N) tous les (12/N) mois.
    const k = 12 / parsed.n;
    return { amount: value * k, intervalMonths: k };
  }
  // Type mensuel non couvert par une règle dédiée (ex. 12/N non entier) :
  // repli au comptant pour rester prudent sur les montants.
  return comptant;
}

export interface ScheduledPayment {
  /** Date de l'échéance. */
  date: Date;
  /** Montant de l'échéance. */
  amount: number;
  /** Rang de l'échéance depuis le closing (0 = première, à la date de closing). */
  index: number;
}

export interface SchedulableSubscription {
  closingDate: Date | string | null;
  subscriptionType: string;
  paymentTiming: string;
  value: number | null | undefined;
}

/**
 * Construit l'échéancier d'un abonnement de la date de closing jusqu'à la borne
 * `horizonEnd` (incluse). Première échéance à la date de closing, puis à chaque
 * périodicité. Les dates sont recalculées depuis le closing à chaque pas pour
 * éviter toute dérive de fin de mois.
 */
export function generatePaymentSchedule(
  sub: SchedulableSubscription,
  horizonEnd: Date,
): ScheduledPayment[] {
  const inst = computeInstallment(sub.subscriptionType, sub.paymentTiming, sub.value ?? null);
  if (!inst || !sub.closingDate) return [];
  const closing = new Date(sub.closingDate);
  if (isNaN(closing.getTime())) return [];

  const out: ScheduledPayment[] = [];
  const MAX = 2000; // garde-fou (5 ans × 12 = 60 max en pratique)
  for (let i = 0; i < MAX; i++) {
    const date = addMonths(closing, inst.intervalMonths * i);
    if (date.getTime() > horizonEnd.getTime()) break;
    out.push({ date, amount: inst.amount, index: i });
  }
  return out;
}

// ─── Prix unitaire du crédit ─────────────────────────────────────────────────
//
// Le CRM ne stocke nulle part le prix d'un crédit : il se déduit de la saisie
// faite dans l'onglet « Abonnement ». La règle de saisie est
//
//     Valeur (MRR ajouté) = prix du crédit × crédits sur l'année ÷ 12
//
// d'où, à l'envers :
//
//     prix du crédit = Valeur × 12 ÷ crédits sur l'année
//
// Le nombre de crédits n'est pas une colonne : il est écrit dans le libellé du
// type (« 2 crédit par mois » → 24 sur l'année, « 4 crédit par an » → 4), que
// parseType sait déjà lire. L'invariant « CA annuel = Valeur × 12 » vaut pour
// TOUTES les cadences (cf. computeInstallment : comptant = Valeur × 12 par an ;
// mensuel = Valeur × 12/N tous les 12/N mois, soit Valeur × 12 sur l'année).

/**
 * Nombre de crédits fournis sur UNE ANNÉE par un type d'abonnement.
 * Renvoie null quand le libellé ne porte pas de crédits annualisables :
 * « multidiffusion » (offre sans crédits) ou libellé hors format.
 */
export function creditsPerYear(subscriptionType: string): number | null {
  const parsed = parseType(normalizeType(subscriptionType));
  if (parsed.multidiffusion) return null;
  if (parsed.n <= 0) return null;
  if (parsed.period === 'mois') return parsed.n * 12;
  if (parsed.period === 'an') return parsed.n;
  return null;
}

/**
 * Prix de vente d'UN crédit pour un abonnement donné, remises comprises : la
 * valeur saisie est le montant réellement négocié, pas un tarif catalogue.
 * Renvoie null si le type ne porte pas de crédits ou si la valeur est absente.
 */
export function creditUnitPrice(
  subscriptionType: string,
  value: number | null | undefined,
): number | null {
  if (value == null || !isFinite(value)) return null;
  const credits = creditsPerYear(subscriptionType);
  if (!credits) return null;
  return (value * 12) / credits;
}

export interface CreditPriceStats {
  /** Prix moyen d'un crédit vendu, pondéré par le volume. null si rien à compter. */
  avgPrice: number | null;
  /** Total des crédits vendus, ramenés à l'année. */
  creditsPerYear: number;
  /** CA annuel des abonnements retenus (somme des valeurs × 12). */
  annualRevenue: number;
  /** Abonnements retenus dans le calcul. */
  counted: number;
  /** Abonnements écartés (multidiffusion, libellé hors format, valeur absente). */
  skipped: number;
}

/**
 * Prix moyen d'un crédit sur un ensemble d'abonnements. La moyenne est PONDÉRÉE
 * (CA annuel total ÷ crédits totaux) et non une moyenne des prix unitaires :
 * sinon un « 1 crédit par an » pèserait autant qu'un « 3 crédit par mois », qui
 * vend 36 fois plus de crédits.
 */
export function averageCreditPrice(
  subs: { subscriptionType: string; value: number | null | undefined }[],
): CreditPriceStats {
  let credits = 0;
  let revenue = 0;
  let counted = 0;
  let skipped = 0;
  for (const s of subs) {
    const n = creditsPerYear(s.subscriptionType);
    if (!n || s.value == null || !isFinite(s.value)) { skipped += 1; continue; }
    credits += n;
    revenue += s.value * 12;
    counted += 1;
  }
  return {
    avgPrice: credits > 0 ? revenue / credits : null,
    creditsPerYear: credits,
    annualRevenue: revenue,
    counted,
    skipped,
  };
}
