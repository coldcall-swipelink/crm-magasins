// src/lib/utils.ts

/** Normalise une chaîne : minuscules, sans accents, sans ponctuation, espaces réduits */
export function normalizeText(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hash djb2 simple pour générer des identifiants courts */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
  }
  return Math.abs(hash).toString(36);
}

/** Couleurs prédéfinies pour les enseignes connues */
const BRAND_COLORS: Record<string, string> = {
  intermarche: '#e11d48',
  leclerc:     '#2563eb',
  'super u':   '#f59e0b',
  carrefour:   '#1d4ed8',
  monoprix:    '#dc2626',
  auchan:      '#7c3aed',
  lidl:        '#ca8a04',
  aldi:        '#16a34a',
  netto:       '#d97706',
  casino:      '#9333ea',
  franprix:    '#c026d3',
};

const PALETTE = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#ec4899','#8b5cf6','#14b8a6','#84cc16','#f97316'];

/** Génère une couleur cohérente pour une enseigne */
export function generateBrandColor(name: string): string {
  const n = normalizeText(name);
  for (const [key, color] of Object.entries(BRAND_COLORS)) {
    if (n.includes(key)) return color;
  }
  const idx = parseInt(simpleHash(name || 'x'), 36) % PALETTE.length;
  return PALETTE[idx];
}

/** Formate une date en français */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Retourne un texte relatif à la date (Aujourd'hui, Dans 2j, Retard 1j…) */
export function formatRelativeDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Demain';
  if (days === -1) return 'Hier';
  if (days > 0) return `Dans ${days}j`;
  return `Retard ${Math.abs(days)}j`;
}

/** Vérifie si une date est dépassée */
export function isOverdue(date: Date | string | null | undefined): boolean {
  if (!date) return false;
  const d = typeof date === 'string' ? new Date(date) : date;
  return d < new Date();
}

/** Classes CSS selon la priorité */
export function priorityColor(priority: string): string {
  const map: Record<string, string> = {
    urgente: 'bg-red-100 text-red-700 border-red-200',
    élevée:  'bg-amber-100 text-amber-700 border-amber-200',
    normale: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    faible:  'bg-slate-100 text-slate-600 border-slate-200',
  };
  return map[priority] || map.normale;
}
