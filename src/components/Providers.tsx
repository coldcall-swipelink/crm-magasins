'use client';
import { CurrentUserProvider } from '@/lib/currentUser';
import { ProspectionModeProvider } from '@/lib/prospectionMode';
import UserGate from '@/components/user/UserGate';

// Wrapper client global : fournit l'identité courante et l'état du mode
// prospection à toute l'app, et affiche l'écran de première connexion tant
// qu'aucun utilisateur n'est défini.
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CurrentUserProvider>
      <ProspectionModeProvider>
        <UserGate>{children}</UserGate>
      </ProspectionModeProvider>
    </CurrentUserProvider>
  );
}
