/**
 * Adresses d'expéditeur autorisées pour l'envoi d'emails depuis le CRM.
 *
 * Toutes sont des adresses @swipelink.fr : le domaine étant déjà vérifié chez
 * Resend, aucun paramétrage supplémentaire n'est nécessaire pour envoyer depuis
 * l'une ou l'autre de ces boîtes. Pour ajouter un expéditeur, il suffit d'ajouter
 * une entrée à la liste ci-dessous (l'adresse doit rester en @swipelink.fr).
 */
export interface EmailSender {
  /** Adresse email seule — sert d'identifiant/valeur dans le <select>. */
  email: string;
  /** Libellé affiché dans le sélecteur. */
  label: string;
  /** Valeur `from` complète transmise à Resend (« Nom <email> »). */
  from: string;
}

export const EMAIL_SENDERS: EmailSender[] = [
  { email: 'hugo@swipelink.fr', label: 'Hugo', from: 'Hugo <hugo@swipelink.fr>' },
  { email: 'bilal@swipelink.fr', label: 'Bilal', from: 'Bilal <bilal@swipelink.fr>' },
  { email: 'mark@swipelink.fr', label: 'Mark', from: 'Mark <mark@swipelink.fr>' },
  { email: 'luca@swipelink.fr', label: 'Luca', from: 'Luca <luca@swipelink.fr>' },
];

/** Expéditeur par défaut : hugo@swipelink.fr (celui déjà en place). */
export const DEFAULT_EMAIL_SENDER = EMAIL_SENDERS[0];

/**
 * Résout la valeur `from` (« Nom <email> ») à partir de l'adresse choisie.
 * Retourne le `from` de l'expéditeur correspondant si l'adresse est autorisée
 * (présente dans EMAIL_SENDERS), sinon null. La comparaison est insensible à la
 * casse et aux espaces.
 */
export function resolveSender(email?: string | null): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  const match = EMAIL_SENDERS.find(s => s.email.toLowerCase() === normalized);
  return match ? match.from : null;
}
