'use client';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';

// Mode prospection : interrupteur global (en haut à droite de chaque écran)
// qui décide si un clic sur « Afficher le numéro » compte comme un appel dans
// les statistiques (ligne CallLog). Désactivé, le numéro se dévoile quand même
// mais rien n'est journalisé : les appels passés hors prospection (SAV, relance
// client, appel perso…) ne faussent plus le compteur.
//
// Le choix est propre au navigateur (localStorage) et survit aux rechargements.
// Par défaut le mode est DÉSACTIVÉ : on l'active volontairement quand on
// démarre une session de prospection.

const STORAGE_KEY = 'crmProspectionMode';

interface Ctx {
  /** true = les appels sont comptabilisés. */
  enabled: boolean;
  /** localStorage lu (évite d'afficher l'état par défaut le temps du montage). */
  ready: boolean;
  setEnabled: (value: boolean) => void;
  toggle: () => void;
}

const ProspectionModeContext = createContext<Ctx | null>(null);

export function ProspectionModeProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setEnabledState(localStorage.getItem(STORAGE_KEY) === '1');
    } catch { /* ignore */ }
    setReady(true);
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    try { localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch { /* ignore */ }
  }, []);

  const toggle = useCallback(() => setEnabled(!enabled), [enabled, setEnabled]);

  return (
    <ProspectionModeContext.Provider value={{ enabled, ready, setEnabled, toggle }}>
      {children}
    </ProspectionModeContext.Provider>
  );
}

export function useProspectionMode(): Ctx {
  const ctx = useContext(ProspectionModeContext);
  if (!ctx) throw new Error('useProspectionMode doit être utilisé dans ProspectionModeProvider');
  return ctx;
}
