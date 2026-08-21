import type { Metadata, Viewport } from 'next';
import './globals.css';
import Providers from '@/components/Providers';

export const metadata: Metadata = {
  title: 'CRM Magasins',
  description: 'CRM commercial pour le suivi des offres emploi',
  applicationName: 'CRM Magasins',
  manifest: '/site.webmanifest',
  icons: {
    // Favicon onglet (ICO multi-tailles + PNG pour les navigateurs modernes).
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48' },
      { url: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/favicon-16.png', type: 'image/png', sizes: '16x16' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    shortcut: '/favicon.ico',
    // Icône « Sur l'écran d'accueil » / widget Safari (iOS & iPadOS).
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'CRM Magasin',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: '#1b47db',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" style={{ height: '100%' }}>
      <body style={{ height: '100%', margin: 0 }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
