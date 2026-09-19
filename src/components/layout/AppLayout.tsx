'use client';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import ProspectionModeToggle from './ProspectionModeToggle';
import { workspaceOf } from '@/lib/workspace';
import Toast from '@/components/ui/Toast';
import NewOffersModal from '@/components/import/NewOffersModal';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // L'outil Campagnes bascule tout le cadre en sombre (cf. Sidebar).
  const dark = workspaceOf(usePathname()).key === 'campaigns';

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Barre globale du CRM : l'interrupteur « Mode prospection » est en
            haut à droite de tous ses écrans, pour l'activer avant une session
            d'appels et le couper dès qu'on passe à autre chose. Il concerne
            les appels téléphoniques du CRM : l'outil Campagnes (emails) n'en a
            pas l'usage, la barre n'y est pas affichée. */}
        {!dark && (
          <div style={{
            flexShrink: 0, height: 42, padding: '0 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            background: '#fff', borderBottom: '1px solid #e2e8f0',
          }}>
            <ProspectionModeToggle />
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto', background: dark ? '#0f1117' : undefined }}>
          {children}
        </div>
      </main>
      <Toast />
      {/* Popup de tri des offres poussées par l'automatisation (N8N) : elle
          s'ouvre d'elle-même à l'arrivée d'un lot, sur n'importe quel écran. */}
      <NewOffersModal />
    </div>
  );
}
