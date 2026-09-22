// src/lib/workspace.ts
//
// Les deux espaces de l'application : le CRM et l'outil Campagnes.
//
// Le CRM (pipeline, paiements, carte, offres reçues…) et l'outil Campagnes
// (séquences d'emails, leads, boîtes d'envoi) sont deux postes de travail
// distincts. On bascule de l'un à l'autre depuis le sélecteur en haut du volet
// gauche ; le volet affiche alors la navigation de l'espace courant. Tout ce
// qui décrit ces espaces — libellés, entrées de menu, page d'accueil — vit ici.

export type WorkspaceKey = 'crm' | 'campaigns';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Actif uniquement si le chemin est exactement celui-ci (racine d'un espace). */
  exact?: boolean;
}

export interface Workspace {
  key: WorkspaceKey;
  label: string;
  description: string;
  icon: string;
  /** Écran ouvert quand on entre dans l'espace sans destination mémorisée. */
  home: string;
  nav: NavItem[];
}

export const WORKSPACES: readonly Workspace[] = [
  {
    key: 'crm',
    label: 'CRM',
    description: 'Pipeline, paiements, carte, offres reçues…',
    icon: '🏪',
    home: '/pipeline',
    nav: [
      { href: '/dashboard',     label: 'Dashboard',     icon: '📊' },
      { href: '/objectifs',     label: 'Objectifs',     icon: '🎯' },
      { href: '/paiements',     label: 'Paiements',     icon: '💶' },
      { href: '/pipeline',      label: 'Pipeline',      icon: '📋' },
      { href: '/carte',         label: 'Carte',         icon: '🗺️' },
      { href: '/import',        label: 'Importer CSV',  icon: '📥' },
      { href: '/offres-recues', label: 'Offres reçues', icon: '📨' },
      { href: '/history',       label: 'Historique',    icon: '🕐' },
      { href: '/actions',       label: 'Actions',       icon: '✅' },
      { href: '/settings',      label: 'Paramètres',    icon: '⚙️' },
    ],
  },
  {
    key: 'campaigns',
    label: 'Campagnes',
    description: "Séquences d'emails, leads, boîtes d'envoi",
    icon: '📣',
    home: '/campagnes',
    nav: [
      { href: '/campagnes',              label: "Vue d'ensemble", icon: '📈', exact: true },
      { href: '/campagnes/sequences',    label: 'Campagnes',      icon: '📣' },
      { href: '/campagnes/leads',        label: 'Leads',          icon: '👥' },
      { href: '/campagnes/declencheurs', label: 'Déclencheurs',   icon: '⚡' },
      { href: '/campagnes/historique',   label: 'Historique',     icon: '🕐' },
      { href: '/campagnes/boites',       label: "Boîtes d'envoi", icon: '📫' },
    ],
  },
];

/** Espace auquel appartient un chemin : tout ce qui est sous /campagnes, et le CRM sinon. */
export function workspaceOf(pathname: string): Workspace {
  const key: WorkspaceKey = pathname === '/campagnes' || pathname.startsWith('/campagnes/') ? 'campaigns' : 'crm';
  return WORKSPACES.find(w => w.key === key)!;
}

export function isNavActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + '/');
}

// ── Mémoire de la dernière page visitée par espace ─────────────────────────
// Quand on bascule vers un espace, on revient là où on l'avait laissé plutôt
// que sur sa page d'accueil. La mémoire vit dans l'onglet du navigateur : elle
// ne survit pas à sa fermeture, et c'est voulu.

const STORAGE_PREFIX = 'crm.workspace.lastPath.';

export function rememberLocation(pathname: string) {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + workspaceOf(pathname).key, pathname);
  } catch { /* stockage indisponible : on ouvrira la page d'accueil */ }
}

/** Destination quand on entre dans un espace : la dernière page vue, sinon son accueil. */
export function entryPath(workspace: Workspace): string {
  try {
    const last = sessionStorage.getItem(STORAGE_PREFIX + workspace.key);
    if (last && workspaceOf(last).key === workspace.key) return last;
  } catch { /* ignore */ }
  return workspace.home;
}
