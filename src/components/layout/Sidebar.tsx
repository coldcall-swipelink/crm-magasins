'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useCurrentUser } from '@/lib/currentUser';
import { useOfferInbox } from '@/lib/offerInboxClient';
import { isNavActive, rememberLocation, workspaceOf } from '@/lib/workspace';
import WorkspaceSwitcher from './WorkspaceSwitcher';

function initials(name: string) { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }

/**
 * Palette du volet, claire dans le CRM et sombre dans l'outil Campagnes.
 *
 * L'outil Campagnes est un poste de travail où l'on passe des heures à lire
 * des tableaux : le fond sombre y fatigue moins. Le basculement porte sur tout
 * le cadre, sans quoi un volet blanc collé à un écran sombre saute aux yeux.
 */
function palette(dark: boolean) {
  return dark
    ? { bg: '#12141c', border: '#242836', title: '#e7e9ef', subtitle: '#6b7283',
        item: '#9aa1b4', itemActive: '#8fb0ff', itemActiveBg: 'rgba(59,113,245,.16)',
        badge: '#3b71f5', foot: '#6b7283', hover: '#1c1f2a', menuBg: '#171a23',
        shadow: '0 12px 32px rgba(0,0,0,.55)' }
    : { bg: '#fff', border: '#e2e8f0', title: '#0f172a', subtitle: '#94a3b8',
        item: '#475569', itemActive: '#4338ca', itemActiveBg: '#eef2ff',
        badge: '#4f46e5', foot: '#94a3b8', hover: '#f1f5f9', menuBg: '#fff',
        shadow: '0 12px 32px rgba(15,23,42,.16)' };
}

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useCurrentUser();
  // Nombre d'offres poussées par l'automatisation et pas encore triées.
  const { pendingCount } = useOfferInbox();
  const workspace = workspaceOf(pathname);
  const c = palette(workspace.key === 'campaigns');

  // Retenir où l'on est, pour y revenir quand on rebascule dans cet espace.
  useEffect(() => { rememberLocation(pathname); }, [pathname]);

  return (
    <aside data-dark={workspace.key === 'campaigns'} style={{ width: 192, flexShrink: 0, background: c.bg, borderRight: `1px solid ${c.border}`, display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0, transition: 'background .18s ease' }}>
      <WorkspaceSwitcher current={workspace} c={c} />
      <nav style={{ flex: 1, padding: '8px 6px', overflowY: 'auto' }}>
        {workspace.nav.map(item => {
          const { href, label, icon } = item;
          const active = isNavActive(pathname, item);
          return (
            <Link key={href} href={href} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 7,
              fontSize: 13, fontWeight: active ? 600 : 400,
              background: active ? c.itemActiveBg : 'transparent',
              color: active ? c.itemActive : c.item,
              marginBottom: 1, textDecoration: 'none',
            }}>
              <span>{icon}</span> {label}
              {href === '/offres-recues' && pendingCount > 0 && (
                <span style={{
                  marginLeft: 'auto', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
                  background: c.badge, color: '#fff', fontSize: 10.5, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {pendingCount > 99 ? '99+' : pendingCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {user && (
        <div style={{ padding: '10px 12px', borderTop: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: user.color, color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {initials(user.name)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: c.title, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
            <button onClick={logout} style={{ fontSize: 10, color: c.foot, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
              Changer d'identité
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
