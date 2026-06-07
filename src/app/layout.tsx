import type { Metadata } from 'next';
import './globals.css';
import Providers from '@/components/Providers';

export const metadata: Metadata = {
  title: 'CRM Magasins · Swipelink',
  description: 'CRM commercial pour le suivi des offres emploi — by Swipelink',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%237c5cff'/><stop offset='1' stop-color='%234f6bff'/></linearGradient></defs><rect width='100' height='100' rx='24' fill='url(%23g)'/><text x='50' y='54' font-size='62' font-family='Arial,Helvetica,sans-serif' font-weight='bold' fill='white' text-anchor='middle' dominant-baseline='central'>S</text></svg>",
  },
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
