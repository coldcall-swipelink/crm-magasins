'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCurrentUser } from '@/lib/currentUser';

function initials(name: string) { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }

const NAV = [
  { href: '/dashboard', label: 'Dashboard',    icon: '📊' },
  { href: '/pipeline',  label: 'Pipeline',      icon: '📋' },
  { href: '/import',    label: 'Importer CSV',  icon: '📥' },
  { href: '/history',   label: 'Historique',    icon: '🕐' },
  { href: '/actions',   label: 'Actions',       icon: '✅' },
  { href: '/settings',  label: 'Paramètres',    icon: '⚙️' },
];

// Sidebar sombre (navy/indigo) inspirée du mockup produit Swipelink :
// fond profond, dégradé violet→bleu sur le logo et l'item actif.
export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useCurrentUser();
  return (
    <aside style={{ width: 204, flexShrink: 0, background: '#171a3a', borderRight: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0 }}>
      <div style={{ padding: '16px 14px 14px', borderBottom: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ width: 32, height: 32, background: 'linear-gradient(135deg,#7c5cff 0%,#4f6bff 100%)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: '#fff', flexShrink: 0, boxShadow: '0 4px 12px rgba(109,90,230,.45)' }}>S</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', letterSpacing: '-.01em' }}>CRM Magasins</div>
          <div style={{ fontSize: 10, color: '#8d90b3', letterSpacing: '.04em' }}>by Swipelink</div>
        </div>
      </div>
      <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto' }}>
        {NAV.map(({ href, label, icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link key={href} href={href} style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '9px 11px', borderRadius: 9,
              fontSize: 13, fontWeight: active ? 600 : 400,
              background: active ? 'rgba(124,108,240,.18)' : 'transparent',
              color: active ? '#fff' : '#b9bbd6',
              boxShadow: active ? 'inset 0 0 0 1px rgba(124,108,240,.35)' : 'none',
              marginBottom: 2, textDecoration: 'none',
            }}>
              <span style={{ opacity: active ? 1 : .85 }}>{icon}</span> {label}
            </Link>
          );
        })}
      </nav>
      {user && (
        <div style={{ padding: '11px 14px', borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: user.color, color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {initials(user.name)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
            <button onClick={logout} style={{ fontSize: 10, color: '#8d90b3', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
              Changer d'identité
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
