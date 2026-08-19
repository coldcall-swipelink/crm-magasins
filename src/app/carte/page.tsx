import AppLayout from '@/components/layout/AppLayout';
import MapView from '@/components/map/MapView';

export const dynamic = 'force-dynamic';

export default function CartePage() {
  return (
    <AppLayout>
      {/* Polices propres à la carte (Fraunces / Hanken Grotesk / JetBrains Mono).
          Chargées ici plutôt que dans le layout racine : elles ne servent qu'à
          cet écran, et src/components/map/map.css déclare des piles de repli. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
      />
      <div style={{ height: '100%' }}>
        <MapView />
      </div>
    </AppLayout>
  );
}
