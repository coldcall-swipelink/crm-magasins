'use client';
// src/components/layout/WorkspaceSwitcher.tsx
//
// Sélecteur d'espace, en haut du volet gauche : le logo, « CRM Magasins », et
// l'espace courant (CRM ou Campagnes). Un clic ouvre le choix de l'autre
// espace ; on y arrive sur la dernière page qu'on y avait laissée.

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WORKSPACES, entryPath, type Workspace } from '@/lib/workspace';

export interface SwitcherPalette {
  bg: string; border: string; title: string; subtitle: string;
  item: string; itemActive: string; itemActiveBg: string; hover: string; menuBg: string; shadow: string;
}

export default function WorkspaceSwitcher({ current, c }: { current: Workspace; c: SwitcherPalette }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Fermer au clic à l'extérieur ou sur Échap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const go = (workspace: Workspace) => {
    setOpen(false);
    if (workspace.key !== current.key) router.push(entryPath(workspace));
  };

  return (
    <div ref={root} style={{ position: 'relative', padding: '10px 6px 8px', borderBottom: `1px solid ${c.border}` }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Changer d'espace"
        className="ws-switch"
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
          padding: '4px 3px', borderRadius: 8, border: '1px solid transparent',
          background: open ? c.hover : 'transparent', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <Image
          src="/logo-mark.png"
          alt="CRM Magasin"
          width={34}
          height={34}
          priority
          style={{ width: 34, height: 34, borderRadius: 8, flexShrink: 0, display: 'block' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: c.title, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>CRM Magasins</div>
          <div style={{ fontSize: 11, color: c.itemActive, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
            <span>{current.icon}</span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{current.label}</span>
          </div>
        </div>
        {/* Chevron : dit qu'on peut cliquer. */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c.subtitle} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div role="listbox" aria-label="Espace" style={{
          position: 'absolute', left: 6, right: 6, top: 'calc(100% - 4px)', zIndex: 60,
          background: c.menuBg, border: `1px solid ${c.border}`, borderRadius: 10,
          boxShadow: c.shadow, padding: 4,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: c.subtitle, padding: '6px 8px 4px' }}>
            Aller dans
          </div>
          {WORKSPACES.map(workspace => {
            const active = workspace.key === current.key;
            return (
              <button
                key={workspace.key}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => go(workspace)}
                className="ws-option"
                style={{
                  width: '100%', display: 'flex', alignItems: 'flex-start', gap: 8, textAlign: 'left',
                  padding: '7px 8px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: active ? c.itemActiveBg : 'transparent',
                }}
              >
                <span style={{ fontSize: 15, lineHeight: '18px' }}>{workspace.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 650, color: active ? c.itemActive : c.title }}>{workspace.label}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: c.subtitle, marginTop: 1, lineHeight: 1.3 }}>{workspace.description}</span>
                </span>
                {active && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c.itemActive} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
