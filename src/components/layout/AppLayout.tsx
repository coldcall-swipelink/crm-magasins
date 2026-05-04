'use client';
// src/components/layout/AppLayout.tsx
import Sidebar from './Sidebar';
import Toast from '@/components/ui/Toast';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>
      <Toast />
    </div>
  );
}
