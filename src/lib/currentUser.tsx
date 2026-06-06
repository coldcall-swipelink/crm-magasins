'use client';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export interface CurrentUser {
  id:    string;
  name:  string;
  color: string;
}

const STORAGE_KEY = 'crmCurrentUser';

// ⚠️ PREVIEW (branche design) : authentification désactivée pour pouvoir
// visualiser l'app sans base de données. Utilisateur « Invité » par défaut.
// À RETIRER avant la mise en prod.
const DISABLE_AUTH = true;
const GUEST_USER: CurrentUser = { id: '', name: 'Invité', color: '#6366f1' };

interface Ctx {
  user:   CurrentUser | null;
  ready:  boolean;                 // localStorage lu (évite le flash au démarrage)
  login:  (name: string) => Promise<void>;
  logout: () => void;
}

const CurrentUserContext = createContext<Ctx | null>(null);

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [ready, setReady] = useState(false);

  // Au montage : restaurer l'identité depuis le navigateur (« authentification »
  // future automatique tant que le localStorage n'est pas vidé).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
      else if (DISABLE_AUTH) setUser(GUEST_USER);
    } catch { if (DISABLE_AUTH) setUser(GUEST_USER); }
    setReady(true);
  }, []);

  const login = useCallback(async (name: string) => {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      // Lit la réponse en texte d'abord pour ne pas planter si le corps n'est
      // pas du JSON (ex : erreur serveur), et remonter un message exploitable.
      const raw = await res.text();
      let msg = `Erreur ${res.status}`;
      try { msg = JSON.parse(raw).error || msg; } catch { if (raw) msg = raw.slice(0, 200); }
      throw new Error(msg);
    }
    const u: CurrentUser = await res.json();
    const compact = { id: u.id, name: u.name, color: u.color };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
    setUser(compact);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }, []);

  return (
    <CurrentUserContext.Provider value={{ user, ready, login, logout }}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser(): Ctx {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) throw new Error('useCurrentUser doit être utilisé dans CurrentUserProvider');
  return ctx;
}
