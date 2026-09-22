'use client';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import ProspectionModeToggle from './ProspectionModeToggle';
import ObjectivesBar from './ObjectivesBar';
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
        {/* Barre globale du CRM : à gauche, les objectifs du commercial
            (cibles Smartlink Brain face au réalisé — ils se surveillent
            pendant qu'on appelle, pas dans un onglet) ; à droite,
            l'interrupteur « Mode prospection », à activer avant une session
            d'appels et à couper dès qu'on passe à autre chose. Les deux
            concernent les appels téléphoniques du CRM : l'outil Campagnes
            (emails) n'en a pas l'usage, la barre n'y est pas affichée. */}
        {!dark && (
          <div style={{
            flexShrink: 0, height: 42, padding: '0 16px',
            display: 'flex', alignItems: 'center', gap: 12,
            background: '#fff', borderBottom: '1px solid #e2e8f0',
          }}>
            <ObjectivesBar />
            {/* marginLeft:auto : l'interrupteur reste à droite même quand la
                barre d'objectifs s'efface (pas d'identité, API en erreur). */}
            <div style={{ marginLeft: 'auto' }}>
              <ProspectionModeToggle />
            </div>
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
