'use client';
import Sidebar from './Sidebar';
import ProspectionModeToggle from './ProspectionModeToggle';
import Toast from '@/components/ui/Toast';
import NewOffersModal from '@/components/import/NewOffersModal';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Barre globale : l'interrupteur « Mode prospection » est en haut à
            droite de tous les écrans, pour l'activer avant une session d'appels
            et le couper dès qu'on passe à autre chose. */}
        <div style={{
          flexShrink: 0, height: 42, padding: '0 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          background: '#fff', borderBottom: '1px solid #e2e8f0',
        }}>
          <ProspectionModeToggle />
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
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
