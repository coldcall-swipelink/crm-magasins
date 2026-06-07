'use client';
import { CurrentUserProvider } from '@/lib/currentUser';

// Wrapper client global : fournit l'identité courante à toute l'app.
// L'écran d'authentification (UserGate) a été retiré — l'app s'ouvre
// directement. L'identité reste optionnelle : les actions/notes non
// attribuées restent anonymes (currentUser = null) tant qu'aucune
// identité n'est définie côté navigateur.
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CurrentUserProvider>
      {children}
    </CurrentUserProvider>
  );
}
