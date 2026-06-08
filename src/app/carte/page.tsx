import AppLayout from '@/components/layout/AppLayout';
import MapView from '@/components/map/MapView';

export const dynamic = 'force-dynamic';

export default function CartePage() {
  return (
    <AppLayout>
      <div style={{ height: '100%' }}>
        <MapView />
      </div>
    </AppLayout>
  );
}
