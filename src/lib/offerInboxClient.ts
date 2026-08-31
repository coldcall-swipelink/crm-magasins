'use client';
import { useEffect, useState } from 'react';
import type { OfferInbox } from '@/types';

/**
 * Relevé partagé de la boîte de réception des offres (cf. /api/offer-inbox).
 *
 * Un SEUL sondage pour toute l'application, quel que soit le nombre de
 * composants abonnés : la popup de tri, le badge de la barre latérale et la
 * page « Offres reçues » lisent le même état. Le sondage ne tourne que s'il
 * reste au moins un abonné, et se relance au retour sur l'onglet (une offre
 * poussée par N8N pendant qu'on était ailleurs apparaît alors tout de suite).
 */

export interface OfferInboxState {
  pendingCount: number;
  inboxes:      OfferInbox[];
  /** Premier relevé pas encore terminé (évite d'ouvrir une popup vide). */
  loading:      boolean;
}

const POLL_MS = 60_000;

let state: OfferInboxState = { pendingCount: 0, inboxes: [], loading: true };
const listeners = new Set<(s: OfferInboxState) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;

function emit() {
  listeners.forEach(listener => listener(state));
}

/** Relève la boîte de réception. Les appels concurrents partagent la requête. */
export function refreshOfferInbox(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = fetch('/api/offer-inbox')
    .then(r => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return;
      state = {
        pendingCount: data.pendingCount ?? 0,
        inboxes: data.inboxes ?? [],
        loading: false,
      };
      emit();
    })
    .catch(() => {
      // Réseau indisponible : on garde l'état précédent et on réessaiera au
      // prochain tour — rien de bloquant pour le reste de l'application.
      state = { ...state, loading: false };
      emit();
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

function start() {
  if (timer) return;
  refreshOfferInbox();
  timer = setInterval(refreshOfferInbox, POLL_MS);
  window.addEventListener('focus', refreshOfferInbox);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  window.removeEventListener('focus', refreshOfferInbox);
}

export function useOfferInbox(): OfferInboxState & { refresh: () => Promise<void> } {
  const [current, setCurrent] = useState<OfferInboxState>(state);

  useEffect(() => {
    listeners.add(setCurrent);
    start();
    setCurrent(state);
    return () => {
      listeners.delete(setCurrent);
      if (listeners.size === 0) stop();
    };
  }, []);

  return { ...current, refresh: refreshOfferInbox };
}
