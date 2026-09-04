// src/lib/callOutcomes.ts
// Résultat d'un appel passé depuis une fiche affaire, tel que la pop-up
// « Est-ce que le décisionnaire a pu être contacté ? » le fait saisir.
//
// Un seul endroit décide des libellés ET des couleurs : la pop-up, le
// calendrier de l'affaire et la route qui enregistre la réponse lisent tous
// cette table. Ajouter un cas ici suffit pour qu'il apparaisse partout.

export const CALL_OUTCOMES = ['JOINT', 'ABSENT', 'REUNION', 'REFUS'] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export interface CallOutcomeStyle {
  /** Libellé affiché dans la pop-up et le calendrier. */
  label: string;
  /** Forme courte, pour les pastilles du calendrier. */
  short: string;
  /** Le décisionnaire a-t-il été joint ? Miroir de CallLog.connected. */
  connected: boolean;
  bg: string;
  border: string;
  text: string;
  /** Couleur pleine, pour les pastilles et la légende. */
  dot: string;
}

// Vert = joint, rouge = absent du magasin, orange = joignable mais pas
// disponible (réunion ou refus) : ce sont les trois lectures utiles quand on
// cherche le bon moment pour rappeler.
export const CALL_OUTCOME_STYLES: Record<CallOutcome, CallOutcomeStyle> = {
  JOINT: {
    label: 'Décisionnaire joint',
    short: 'Joint',
    connected: true,
    bg: '#f0fdf4', border: '#bbf7d0', text: '#166534', dot: '#16a34a',
  },
  ABSENT: {
    label: 'Pas sur le magasin',
    short: 'Absent',
    connected: false,
    bg: '#fef2f2', border: '#fecaca', text: '#b91c1c', dot: '#dc2626',
  },
  REUNION: {
    label: 'En réunion',
    short: 'Réunion',
    connected: false,
    bg: '#fff7ed', border: '#fed7aa', text: '#9a3412', dot: '#ea580c',
  },
  REFUS: {
    label: "Refus de prendre l'appel",
    short: 'Refus',
    connected: false,
    bg: '#fff7ed', border: '#fed7aa', text: '#9a3412', dot: '#ea580c',
  },
};

/** Apparence d'un appel encore sans réponse (pop-up ignorée ou appel ancien). */
export const CALL_OUTCOME_UNKNOWN: CallOutcomeStyle = {
  label: 'Sans réponse à la pop-up',
  short: 'Inconnu',
  connected: false,
  bg: '#f8fafc', border: '#e2e8f0', text: '#64748b', dot: '#94a3b8',
};

/**
 * Appels antérieurs au détail du motif : on sait seulement que le décisionnaire
 * n'a pas été joint. Rouge comme une absence, mais sans prétendre savoir
 * pourquoi — la raison n'avait pas été demandée.
 */
export const CALL_OUTCOME_LEGACY_MISSED: CallOutcomeStyle = {
  label: 'Décisionnaire non joint',
  short: 'Non joint',
  connected: false,
  bg: '#fef2f2', border: '#fecaca', text: '#b91c1c', dot: '#dc2626',
};

export function isCallOutcome(v: unknown): v is CallOutcome {
  return typeof v === 'string' && (CALL_OUTCOMES as readonly string[]).includes(v);
}

/**
 * Apparence d'un appel journalisé. `outcome` fait foi ; les appels antérieurs
 * à ce champ ne connaissent que `connected` : joint (vert) ou non joint
 * (rouge, sans motif — il n'était pas demandé).
 */
export function callOutcomeStyle(outcome: string | null | undefined, connected: boolean | null | undefined): CallOutcomeStyle {
  if (isCallOutcome(outcome)) return CALL_OUTCOME_STYLES[outcome];
  if (connected === true) return CALL_OUTCOME_STYLES.JOINT;
  if (connected === false) return CALL_OUTCOME_LEGACY_MISSED;
  return CALL_OUTCOME_UNKNOWN;
}
