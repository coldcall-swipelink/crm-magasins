'use client';
import { useEffect, useState } from 'react';
import { formatRelativeDate } from '@/lib/utils';
import type { EmailOpenNotif } from './NotificationCenter';

interface Props {
  /** Notifications d'ouverture NON LUES (le composant n'affiche que ça). */
  notifications: EmailOpenNotif[];
  /** Ouvre la fiche de l'affaire (et acquitte ses notifications). */
  onOpenDeal: (dealId: string) => void;
}

// Clé sessionStorage des alertes écartées avec « Plus tard » : on ne re-harcèle
// pas dans le même onglet, mais un rechargement de page les ré-affiche tant que
// la notification n'est pas acquittée (c'est voulu : ça pousse à appeler).
const DISMISSED_KEY = 'emailOpenAlertDismissed';

function loadDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * Alerte « chaude » plein écran (coin bas-droit, au-dessus de tout) : dès qu'un
 * contact ouvre un email, une carte orange animée s'affiche avec un bouton
 * « Appeler maintenant » qui ouvre la fiche de l'affaire — c'est là que le
 * numéro se dévoile (clic comptabilisé comme un appel, cf. reveal-phone).
 *
 * Contrairement au badge de la cloche, impossible à rater : c'est l'élément
 * qui pousse à décrocher le téléphone dans les minutes qui suivent l'ouverture.
 */
export default function EmailOpenAlert({ notifications, onOpenDeal }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  // sessionStorage n'existe qu'au client : lecture après montage.
  useEffect(() => {
    setDismissed(loadDismissed());
    setHydrated(true);
  }, []);

  const dismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try { sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(next))); } catch { /* silencieux */ }
      return next;
    });
  };

  if (!hydrated) return null;

  const visible = notifications.filter((n) => !n.isRead && !dismissed.has(n.id)).slice(0, 3);
  const hiddenCount = notifications.filter((n) => !n.isRead && !dismissed.has(n.id)).length - visible.length;
  if (visible.length === 0) return null;

  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 90, display: 'flex', flexDirection: 'column', gap: 10, width: 380, maxWidth: 'calc(100vw - 40px)' }}>
      <style>{`
        @keyframes emailOpenAlertIn {
          from { opacity: 0; transform: translateY(14px) scale(.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes emailOpenAlertPulse {
          0%, 100% { box-shadow: 0 12px 32px rgba(234,88,12,.35), 0 0 0 0 rgba(234,88,12,.45); }
          50%      { box-shadow: 0 12px 32px rgba(234,88,12,.35), 0 0 0 9px rgba(234,88,12,0); }
        }
        @keyframes emailOpenAlertBlink {
          0%, 100% { opacity: 1; } 50% { opacity: .35; }
        }
      `}</style>

      {hiddenCount > 0 && (
        <div style={{ alignSelf: 'flex-end', fontSize: 11.5, fontWeight: 700, color: '#9a3412', background: '#ffedd5', border: '1px solid #fed7aa', padding: '4px 10px', borderRadius: 999 }}>
          + {hiddenCount} autre{hiddenCount > 1 ? 's' : ''} email{hiddenCount > 1 ? 's' : ''} ouvert{hiddenCount > 1 ? 's' : ''} (voir la cloche 🔔)
        </div>
      )}

      {visible.map((n) => {
        const storeName = n.deal?.store?.name || 'Affaire';
        const brandName = n.deal?.store?.brand?.name;
        const contact = n.deal?.contactCalling;
        return (
          <div
            key={n.id}
            style={{
              background: '#fff', borderRadius: 14, border: '2px solid #ea580c', overflow: 'hidden',
              animation: 'emailOpenAlertIn .25s ease-out, emailOpenAlertPulse 1.6s ease-in-out infinite',
            }}
          >
            {/* Bandeau d'urgence */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'linear-gradient(90deg, #ea580c, #f97316)', padding: '8px 14px' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#fff', animation: 'emailOpenAlertBlink 1s ease-in-out infinite', flexShrink: 0 }} />
              <span style={{ color: '#fff', fontSize: 12.5, fontWeight: 800, letterSpacing: '.3px', textTransform: 'uppercase', flex: 1 }}>
                Email ouvert — c&apos;est le moment d&apos;appeler !
              </span>
              <button
                onClick={() => dismiss(n.id)}
                title="Plus tard (reste dans la cloche)"
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.85)', fontSize: 15, cursor: 'pointer', padding: 0, lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: '#0f172a', lineHeight: 1.3 }}>
                {storeName}{brandName ? <span style={{ color: '#64748b', fontWeight: 600 }}> · {brandName}</span> : null}
              </div>
              <div style={{ fontSize: 12.5, color: '#334155', marginTop: 4, lineHeight: 1.4 }}>
                {contact ? <><strong>{contact}</strong> vient d&apos;ouvrir votre email</> : <>Votre contact vient d&apos;ouvrir votre email</>}
                {n.subject ? <> « {n.subject} »</> : null}
                <span style={{ color: '#94a3b8' }}> · {formatRelativeDate(n.openedAt)}</span>
              </div>
              <div style={{ fontSize: 11.5, color: '#9a3412', marginTop: 6, fontWeight: 600 }}>
                Il pense à vous en ce moment même : un appel dans les 5 minutes multiplie vos chances de le joindre.
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
                <button
                  onClick={() => onOpenDeal(n.dealId)}
                  style={{
                    flex: 1, height: 38, borderRadius: 9, border: 'none', cursor: 'pointer',
                    background: '#ea580c', color: '#fff', fontSize: 13.5, fontWeight: 800,
                    boxShadow: '0 2px 8px rgba(234,88,12,.4)',
                  }}
                >
                  📞 Appeler maintenant
                </button>
                <button
                  onClick={() => dismiss(n.id)}
                  style={{
                    height: 38, padding: '0 14px', borderRadius: 9, border: '1px solid #e2e8f0',
                    background: '#fff', color: '#64748b', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Plus tard
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
