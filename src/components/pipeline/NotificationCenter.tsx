'use client';
import { useEffect, useRef, useState } from 'react';
import { formatRelativeDate, formatDate } from '@/lib/utils';

export interface OfferNotification {
  id: string;
  dealId: string;
  organizationId: string;
  offerId: string;
  offerTitle: string;
  offerCreatedAt: string;
  isRead: boolean;
  createdAt: string;
  deal?: { id: string; store?: { name?: string; brand?: { name?: string } | null } | null } | null;
}

interface Props {
  notifications: OfferNotification[];
  unreadCount: number;
  /** Ouvre l'affaire liée à la notification (et l'acquitte). */
  onOpenDeal: (dealId: string) => void;
  /** Marque toutes les notifications comme lues. */
  onMarkAllRead: () => void;
}

/**
 * Cloche + panneau déroulant du pipeline listant les offres créées par les
 * organisations rattachées (« Nouvelle offre créée : … »). Un badge indique le
 * nombre d'offres non acquittées.
 */
export default function NotificationCenter({ notifications, unreadCount, onOpenDeal, onMarkAllRead }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fermeture au clic extérieur.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Notifications d'offres"
        style={{
          position: 'relative', height: 38, width: 40, borderRadius: 9,
          border: `1px solid ${open ? '#c7d2fe' : '#e2e8f0'}`,
          background: open ? '#eef2ff' : '#fff', cursor: 'pointer', fontSize: 17,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569',
        }}
      >
        🔔
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, padding: '0 4px',
              borderRadius: 999, background: '#3b82f6', color: '#fff', fontSize: 10.5, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: 46, right: 0, width: 360, maxHeight: 460, overflowY: 'auto',
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, zIndex: 50,
            boxShadow: '0 10px 30px rgba(15,23,42,0.15)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid #f1f5f9', position: 'sticky', top: 0, background: '#fff' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
              Notifications{unreadCount > 0 ? ` · ${unreadCount} nouvelle${unreadCount > 1 ? 's' : ''}` : ''}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllRead}
                style={{ background: 'none', border: 'none', color: '#4f46e5', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
              >
                Tout marquer comme lu
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div style={{ padding: '28px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>
              Aucune notification d&apos;offre pour le moment.
            </div>
          ) : (
            notifications.map((n) => {
              const storeName = n.deal?.store?.name || 'Affaire';
              const brandName = n.deal?.store?.brand?.name;
              return (
                <button
                  key={n.id}
                  onClick={() => { onOpenDeal(n.dealId); setOpen(false); }}
                  style={{
                    display: 'flex', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer',
                    padding: '11px 14px', borderBottom: '1px solid #f8fafc',
                    background: n.isRead ? '#fff' : '#eff6ff', border: 'none',
                  }}
                >
                  <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#dbeafe', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>💼</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, color: '#0f172a', lineHeight: 1.35 }}>
                      Nouvelle offre créée : <strong>{n.offerTitle || 'Offre'}</strong>
                    </span>
                    <span style={{ display: 'block', fontSize: 11, color: '#64748b', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {[brandName, storeName].filter(Boolean).join(' · ')}
                    </span>
                    <span style={{ display: 'block', fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>
                      {formatRelativeDate(n.offerCreatedAt)} · {formatDate(n.offerCreatedAt)}
                    </span>
                  </span>
                  {!n.isRead && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', flexShrink: 0, marginTop: 4 }} />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
