// src/lib/pipelineStages.ts
//
// Vocabulaire des étapes qui déclenchent quelque chose à l'arrivée d'une
// affaire (pop-up, séquence n8n, visio…). Partagé par les deux chemins qui
// déplacent une affaire — le drag & drop du pipeline et la frise de la fiche —
// pour qu'ils reconnaissent exactement les mêmes étapes.

import type { Subscription } from '@/types';

/** Colonne « Démo prévue » du pipeline Prospection (pop-up PV). */
export const PROSPECTION_DEMO_TITLE = 'Démo prévue';
/** Colonne « DEMO PREVUE » du pipeline Closing (pop-up invitation Meet). */
export const CLOSING_DEMO_TITLE = 'DEMO PREVUE';
/** Pipeline cible du workflow « Prospection de Valeur ». */
export const CLOSING_PIPELINE_NAME = 'Closing';

/** Séquence automatique n8n déclenchée à l'arrivée dans la colonne. */
export type FlowKey = 'DEMO_FAITE' | 'RELANCE_1';

/** Vrai si le titre de colonne correspond à l'étape « SMARTLINKÉ »
 *  (insensible à la casse et aux accents). */
export function isSmartlinkColumn(title?: string | null): boolean {
  if (!title) return false;
  return title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes('smartlink');
}

/**
 * Séquence automatique n8n déclenchée à l'arrivée dans la colonne, ou null.
 * Les titres sont comparés à l'identique de ce que teste /api/deals/[id]/move
 * pour envoyer le webhook : la pop-up prévient exactement quand ça part.
 */
export function flowForColumn(title?: string | null): FlowKey | null {
  if (title === 'DEMO FAITE') return 'DEMO_FAITE';
  if (title === 'RELANCE 1') return 'RELANCE_1';
  return null;
}

/** Date saisie ("YYYY-MM-DD") → ISO à midi UTC, pour qu'aucun fuseau ne la
 *  fasse basculer d'un jour. */
export function toIsoNoon(date: string): string {
  return new Date(`${date}T12:00:00Z`).toISOString();
}

/**
 * Intitulé d'un abonnement dans la pop-up de dates de closing. Son rang dans
 * l'affaire est ce qui compte pour s'y retrouver ; le type et la valeur, quand
 * ils sont renseignés, lèvent le doute restant.
 */
export function subscriptionLabel(sub: Subscription, all: Subscription[]): string {
  const rank = all.findIndex(s => s.id === sub.id) + 1;
  const details = [sub.subscriptionType, sub.value != null ? `${sub.value} €` : '']
    .filter(Boolean)
    .join(' · ');
  return details ? `Abonnement ${rank} — ${details}` : `Abonnement ${rank}`;
}
