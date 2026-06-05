'use client';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export interface CurrentUser {
  id:    string;
  name:  string;
  color: string;
}

const STORAGE_KEY = 'crmCurrentUser';

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
    } catch { /* ignore */ }
    setReady(true);
  }, []);

  const login = useCallback(async (name: string) => {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Connexion impossible');
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
