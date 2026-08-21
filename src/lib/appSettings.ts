// Clés des réglages globaux stockés dans la table AppSetting (clé/valeur).

/**
 * Signature email « globale » (héritée). Sert désormais de repli (fallback)
 * quand l'expéditeur choisi n'a pas de signature dédiée. Conservée pour la
 * compatibilité avec l'existant.
 */
export const EMAIL_SIGNATURE_KEY = 'emailSignature';

/**
 * Clé de la signature propre à un expéditeur donné, ex.
 * « emailSignature:bilal@swipelink.fr ». L'adresse est normalisée en minuscules
 * pour rendre la clé insensible à la casse.
 */
export function signatureKeyForSender(email: string): string {
  return `${EMAIL_SIGNATURE_KEY}:${email.trim().toLowerCase()}`;
}

/**
 * Relance des affaires laissées dans « LIEN PAIEMENT ENVOYÉ » (cf.
 * src/lib/paymentFollowUp.ts). Le contenu du mail, l'expéditeur et le délai
 * avant relance se règlent dans Paramètres › Relance « lien de paiement ».
 */
export const PAYMENT_FOLLOWUP_KEYS = {
  subject:   'paymentFollowUp:subject',
  body:      'paymentFollowUp:body',
  from:      'paymentFollowUp:from',
  delayDays: 'paymentFollowUp:delayDays',
} as const;
