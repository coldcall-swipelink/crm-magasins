'use client';
import { CurrentUserProvider } from '@/lib/currentUser';
import UserGate from '@/components/user/UserGate';

// Wrapper client global : fournit l'identité courante à toute l'app et
// affiche l'écran de première connexion tant qu'aucun utilisateur n'est défini.
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CurrentUserProvider>
      <UserGate>{children}</UserGate>
    </CurrentUserProvider>
  );
}
