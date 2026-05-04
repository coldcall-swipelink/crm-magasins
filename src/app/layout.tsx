import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CRM Magasins',
  description: 'CRM commercial pour le suivi des offres emploi',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" style={{ height: '100%' }}>
      <body style={{ height: '100%', margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
