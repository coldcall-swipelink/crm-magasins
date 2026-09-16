// src/components/campaigns/ui.ts
//
// Jetons de style et briques partagées des écrans Campagnes.
//
// L'onglet Campagnes est le seul écran sombre du CRM : c'est un poste de
// travail où l'on passe des heures à lire des tableaux, et le fond sombre y
// fatigue moins que le blanc des écrans de saisie. Le reste du CRM est
// inchangé — le thème est porté par cet onglet, pas par l'application.
//
// Le CRM n'utilise pas Tailwind : les styles vivent dans des objets React.
// Tout part donc d'ici, pour qu'une couleur se change à un seul endroit.

/** Jetons de couleur. Une seule échelle, du fond le plus sombre au texte. */
export const T = {
  // Fonds, du plus profond au plus clair
  bg:         '#0f1117',   // fond de l'application
  bgPanel:    '#12141c',   // volet de navigation
  surface:    '#171a23',   // cartes, tableaux
  surfaceAlt: '#1c1f2a',   // en-têtes de tableau, survol, champs
  surfaceHi:  '#222634',   // éléments actifs

  // Traits
  border:     '#262b38',
  borderSoft: '#1e222d',

  // Textes
  text:       '#e7e9ef',
  textMuted:  '#9aa1b4',
  textFaint:  '#6b7283',

  // Accent et états
  primary:    '#3b71f5',
  primaryHi:  '#4d80ff',
  primarySoft:'rgba(59, 113, 245, .16)',
  primaryText:'#8fb0ff',
  success:    '#22c55e',
  successSoft:'rgba(34, 197, 94, .15)',
  warn:       '#f59e0b',
  warnSoft:   'rgba(245, 158, 11, .14)',
  warnText:   '#fbbf24',
  danger:     '#ef4444',
  dangerSoft: 'rgba(239, 68, 68, .13)',
  dangerText: '#f87171',
  violet:     '#8b5cf6',
  violetSoft: 'rgba(139, 92, 246, .14)',
  violetText: '#a78bfa',
} as const;

/** Champ de saisie. La classe porte le focus et la transition (cf. globals.css). */
export const inp: React.CSSProperties = {
  width: '100%', padding: '8px 11px', borderRadius: 8, border: `1px solid ${T.border}`,
  background: T.surfaceAlt, color: T.text, fontSize: 13, outline: 'none',
};

/** Action principale. */
export const btnPri: React.CSSProperties = {
  padding: '8px 15px', borderRadius: 8, border: '1px solid transparent', background: T.primary,
  color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13,
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
};

/** Action secondaire. */
export const btnDef: React.CSSProperties = {
  padding: '8px 15px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.surfaceAlt,
  color: T.text, fontWeight: 500, cursor: 'pointer', fontSize: 13,
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
};

/** Action discrète, dans une ligne de tableau ou une carte. */
export const btnXs: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 7, border: `1px solid ${T.border}`, background: T.surfaceAlt,
  color: T.textMuted, cursor: 'pointer', fontSize: 11.5, whiteSpace: 'nowrap',
};

/** Action destructrice : jamais un bouton plein, toujours une teinte. */
export const btnDanger: React.CSSProperties = {
  ...btnDef, borderColor: 'rgba(239, 68, 68, .35)', background: T.dangerSoft, color: T.dangerText,
};

export const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: T.textMuted, display: 'block', marginBottom: 5,
  letterSpacing: '.01em',
};

export const card: React.CSSProperties = {
  background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 18,
};

/**
 * Voile des fenêtres modales.
 *
 * Plus dense que sur fond clair : sur un écran sombre, un voile léger ne
 * détache pas la fenêtre du fond — les deux se confondent en gris.
 */
export const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(5, 7, 12, .68)', backdropFilter: 'blur(2px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 24,
};

/** Fenêtre modale : une carte, posée au-dessus, avec l'ombre qui le dit. */
export const modal: React.CSSProperties = {
  ...card, padding: 20, boxShadow: '0 24px 64px rgba(0, 0, 0, .6)',
};

/** Pastille de statut : teinte de la couleur, jamais de fond plein. */
export function pill(color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', padding: '2px 9px', borderRadius: 999,
    fontSize: 11, fontWeight: 600, color, background: `${color}22`,
    border: `1px solid ${color}33`, whiteSpace: 'nowrap',
  };
}

/** Onglet ou filtre en forme de pastille cliquable. */
export function chip(active: boolean, color = T.primary): React.CSSProperties {
  return {
    padding: '5px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12,
    fontWeight: active ? 650 : 500,
    border: `1px solid ${active ? `${color}66` : T.border}`,
    background: active ? `${color}1f` : 'transparent',
    color: active ? color : T.textMuted,
  };
}

/** Couleur et libellé d'un statut de campagne. */
export const CAMPAIGN_STATUS: Record<string, { label: string; color: string }> = {
  draft:    { label: 'Brouillon', color: T.textFaint },
  running:  { label: 'En cours',  color: '#4ade80' },
  paused:   { label: 'En pause',  color: T.warnText },
  finished: { label: 'Terminée',  color: T.primaryText },
  archived: { label: 'Archivée',  color: T.textFaint },
};

/** Statut d'un lead DANS une campagne (inscription). */
export const ENROLLMENT_STATUS: Record<string, { label: string; color: string }> = {
  active:   { label: 'En cours',  color: '#4ade80' },
  sending:  { label: 'Envoi…',    color: '#38bdf8' },
  paused:   { label: 'En pause',  color: T.warnText },
  finished: { label: 'Terminé',   color: T.primaryText },
  stopped:  { label: 'Arrêté',    color: T.dangerText },
};

/** Pourquoi une inscription s'est arrêtée. */
export const STOP_REASONS: Record<string, string> = {
  replied: 'a répondu',
  manual: 'arrêté à la main',
  unsubscribed: 'désinscrit',
  bounced: 'adresse morte',
  completed: 'séquence terminée',
  failed: 'échec d\'envoi',
};

/** « 72 » → « 3 jours » : un délai se lit en jours, pas en heures. */
export function formatDelay(hours: number): string {
  if (hours <= 0) return 'immédiat';
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  const dayLabel = `${days} jour${days > 1 ? 's' : ''}`;
  return rest ? `${dayLabel} et ${rest} h` : dayLabel;
}
