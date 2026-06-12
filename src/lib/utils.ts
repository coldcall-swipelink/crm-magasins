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

/** Assombrit une couleur hex (#rrggbb) d'un facteur 0→1 (0.3 = 30 % plus sombre) */
export function darkenHex(hex: string, amount = 0.35): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const factor = Math.max(0, Math.min(1, 1 - amount));
  const r = Math.round(((num >> 16) & 0xff) * factor);
  const g = Math.round(((num >> 8) & 0xff) * factor);
  const b = Math.round((num & 0xff) * factor);
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** Formate une date en français */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Formate un montant en euros (€), arrondi au centime. Chaîne vide si pas de valeur. */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

/** Retourne un texte relatif à la date en comparant uniquement les jours (sans heure) */
export function formatRelativeDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  // Comparer uniquement les dates sans l'heure pour éviter les décalages UTC
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((dDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return 'Demain';
  if (diffDays === -1) return 'Hier';
  if (diffDays > 0) return `Dans ${diffDays}j`;
  return `Retard ${Math.abs(diffDays)}j`;
}

/** Vérifie si une date est dépassée (comparaison par jour, sans heure) */
export function isOverdue(date: Date | string | null | undefined): boolean {
  if (!date) return false;
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return dDay < today;
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
