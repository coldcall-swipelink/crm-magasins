'use client';
import Sidebar from './Sidebar';
import Toast from '@/components/ui/Toast';
import PaymentFollowUpGate from '@/components/followup/PaymentFollowUpGate';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {children}
        </div>
      </main>
      <Toast />
      {/* Pop-up du matin : relances « lien de paiement » à valider (Hugo / Bilal). */}
      <PaymentFollowUpGate />
    </div>
  );
}
