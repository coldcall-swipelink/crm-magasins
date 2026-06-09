'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/dashboard', label: 'Dashboard',    icon: '📊' },
  { href: '/pipeline',  label: 'Pipeline',      icon: '📋' },
  { href: '/import',    label: 'Importer CSV',  icon: '📥' },
  { href: '/history',   label: 'Historique',    icon: '🕐' },
  { href: '/actions',   label: 'Actions',       icon: '✅' },
  { href: '/settings',  label: 'Paramètres',    icon: '⚙️' },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside style={{ width: 192, flexShrink: 0, background: '#fff', borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0 }}>
      <div style={{ padding: '14px 12px 10px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 30, height: 30, background: '#4f46e5', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>⚡</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>CRM Magasins</div>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>v2 · Offres emploi</div>
        </div>
      </div>
      <nav style={{ flex: 1, padding: '8px 6px', overflowY: 'auto' }}>
        {NAV.map(({ href, label, icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link key={href} href={href} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 7,
              fontSize: 13, fontWeight: active ? 600 : 400,
              background: active ? '#eef2ff' : 'transparent',
              color: active ? '#4338ca' : '#475569',
              marginBottom: 1, textDecoration: 'none',
            }}>
              <span>{icon}</span> {label}
            </Link>
          );
        })}
      </nav>
      <div style={{ padding: '10px 12px', borderTop: '1px solid #e2e8f0', fontSize: 11, color: '#94a3b8' }}>
        Données en temps réel
      </div>
    </aside>
  );
}
