// src/lib/paymentLinkSlots.ts
//
// ARCHITECTURE FIXE des liens de paiement « classiques ».
//
// Les offres standard ne sont pas une liste libre : elles suivent toujours le
// même plan à trois niveaux — l'offre, le jeu de tarifs, le mode de paiement.
// Ce plan est décrit ici, en dur, et donne 7 × 2 × 3 = 42 « cases ».
//
// Chaque case est une place à remplir : c'est dans les Paramètres qu'on désigne,
// pour chacune, le Payment Link Stripe correspondant. Une case non attribuée
// reste visible mais non sélectionnable, ce qui rend le trou évident au lieu de
// le cacher.
//
// Conséquence importante : un lien Stripe est « classique » PARCE QU'il occupe
// une case. Tous les autres liens actifs sont « spéciaux » (créés pour un seul
// client) — il n'y a rien à cocher, la distinction se déduit de l'attribution.

export interface SlotDimension {
  /** Identifiant stable, utilisé dans la clé de case stockée en base. */
  key: string;
  label: string;
}

/** Niveau 1 — l'offre. L'ordre est celui voulu par le CRM, pas un tri. */
export const PAYMENT_OFFERS: SlotDimension[] = [
  { key: 'c1-mois', label: '1 crédit/mois' },
  { key: 'c2-mois', label: '2 crédits/mois' },
  { key: 'c3-mois', label: '3 crédits/mois' },
  { key: 'c6-an', label: '6 crédits/an' },
  { key: 'c4-an', label: '4 crédits/an' },
  { key: 'c2-an', label: '2 crédits/an' },
  { key: 'c1-an', label: '1 crédit/an' },
];

/** Niveau 2 — le jeu de tarifs. « Anciens tarifs » sert aux clients historiques. */
export const PAYMENT_TARIFFS: SlotDimension[] = [
  { key: 'actuel', label: 'Tarifs actuels' },
  { key: 'ancien', label: 'Anciens tarifs' },
];

/** Niveau 3 — le mode de paiement. */
export const PAYMENT_MODES: SlotDimension[] = [
  { key: 'mensuel', label: 'Paiement mensuel' },
  { key: 'comptant-remise', label: 'Paiement comptant (réduction 5%)' },
  { key: 'comptant', label: 'Paiement comptant (sans réduction)' },
];

/** Clé stable d'une case, telle qu'elle est stockée en base. */
export function buildSlotKey(offerKey: string, tariffKey: string, modeKey: string): string {
  return `${offerKey}/${tariffKey}/${modeKey}`;
}

/** Une case du plan, sans son attribution. */
export interface PaymentLinkSlotDefinition {
  slotKey: string;
  offerKey: string;
  offerLabel: string;
  tariffKey: string;
  tariffLabel: string;
  modeKey: string;
  modeLabel: string;
  /** « 1 crédit/mois · Tarifs actuels · Paiement mensuel ». */
  fullLabel: string;
}

/**
 * Les 42 cases, dans l'ordre du plan (offre, puis tarifs, puis mode). C'est cet
 * ordre qui pilote aussi bien l'écran de paramétrage que les listes déroulantes
 * de la fiche affaire : une seule définition, aucune divergence possible.
 */
export const PAYMENT_LINK_SLOTS: PaymentLinkSlotDefinition[] = PAYMENT_OFFERS.flatMap(offer =>
  PAYMENT_TARIFFS.flatMap(tariff =>
    PAYMENT_MODES.map(mode => ({
      slotKey: buildSlotKey(offer.key, tariff.key, mode.key),
      offerKey: offer.key,
      offerLabel: offer.label,
      tariffKey: tariff.key,
      tariffLabel: tariff.label,
      modeKey: mode.key,
      modeLabel: mode.label,
      fullLabel: `${offer.label} · ${tariff.label} · ${mode.label}`,
    })),
  ),
);

/** Vrai si la clé correspond à une case du plan (garde-fou côté API). */
export function isKnownSlotKey(key: unknown): key is string {
  return typeof key === 'string' && PAYMENT_LINK_SLOTS.some(s => s.slotKey === key);
}
