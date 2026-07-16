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
//        lorsque 12 / N est entier (1, 2, 4, 6, 12 crédits/an). Sinon, repli
//        au comptant. Exemples issus des règles :
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
