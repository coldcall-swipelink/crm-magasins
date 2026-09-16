// src/components/campaigns/ui.ts
//
// Styles partagés des écrans Campagnes. Le CRM n'utilise pas Tailwind : les
// styles vivent dans des objets React, et ceux-ci reprennent exactement le
// vocabulaire visuel de src/lib/styles.ts pour que l'onglet ne détonne pas.

export const inp: React.CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0',
  background: '#f8fafc', color: '#0f172a', fontSize: 13, outline: 'none',
};

export const btnPri: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4f46e5',
  color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 13,
};

export const btnDef: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9',
  color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 13,
};

export const btnXs: React.CSSProperties = {
  padding: '4px 9px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f1f5f9',
  color: '#334155', cursor: 'pointer', fontSize: 11.5,
};

export const btnDanger: React.CSSProperties = {
  ...btnDef, borderColor: '#fecaca', background: '#fef2f2', color: '#b91c1c',
};

export const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4,
};

export const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16,
};

/** Couleur et libellé d'un statut de campagne. */
export const CAMPAIGN_STATUS: Record<string, { label: string; color: string }> = {
  draft:    { label: 'Brouillon', color: '#64748b' },
  running:  { label: 'En cours',  color: '#16a34a' },
  paused:   { label: 'En pause',  color: '#d97706' },
  finished: { label: 'Terminée',  color: '#4f46e5' },
  archived: { label: 'Archivée',  color: '#94a3b8' },
};

/** Statut d'un lead DANS une campagne (inscription). */
export const ENROLLMENT_STATUS: Record<string, { label: string; color: string }> = {
  active:   { label: 'En cours',  color: '#16a34a' },
  sending:  { label: 'Envoi…',    color: '#0ea5e9' },
  paused:   { label: 'En pause',  color: '#d97706' },
  finished: { label: 'Terminé',   color: '#4f46e5' },
  stopped:  { label: 'Arrêté',    color: '#dc2626' },
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
