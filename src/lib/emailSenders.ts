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
  { email: 'hugo@swipelink.fr', label: 'Hugo', from: 'Hugo - Swipelink <hugo@swipelink.fr>' },
  { email: 'bilal@swipelink.fr', label: 'Bilal', from: 'Bilal Yacouti - Swipelink <bilal@swipelink.fr>' },
  { email: 'mark@swipelink.fr', label: 'Mark', from: 'Mark - Swipelink <mark@swipelink.fr>' },
  { email: 'luca@swipelink.fr', label: 'Luca', from: 'Luca - Swipelink <luca@swipelink.fr>' },
];

/**
 * Expéditeur par défaut : hugo@swipelink.fr (celui déjà en place). Sert de
 * repli quand l'utilisateur connecté n'est pas identifiable (voir senderForUser).
 */
export const DEFAULT_EMAIL_SENDER = EMAIL_SENDERS[0];

/** Minuscules sans accents, pour comparer prénoms et libellés. */
function normalizeName(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Résout l'expéditeur correspondant à un utilisateur du CRM (compte connecté) :
 * par adresse email d'abord (compte qui se connecte directement avec son
 * adresse @swipelink.fr), sinon par prénom — un mot du nom de l'utilisateur
 * égal au libellé d'un expéditeur, insensible à la casse et aux accents
 * (« Bilal Yacouti » → bilal@swipelink.fr). Retourne null si aucun ne
 * correspond ; l'appelant garde alors DEFAULT_EMAIL_SENDER.
 */
export function senderForUser(
  user?: { name?: string | null; email?: string | null } | null
): EmailSender | null {
  if (!user) return null;
  const email = (user.email || '').trim().toLowerCase();
  if (email) {
    const byEmail = EMAIL_SENDERS.find(s => s.email.toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  const words = normalizeName(user.name || '').split(/\s+/).filter(Boolean);
  if (words.length) {
    const byName = EMAIL_SENDERS.find(s => words.includes(normalizeName(s.label)));
    if (byName) return byName;
  }
  return null;
}

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
