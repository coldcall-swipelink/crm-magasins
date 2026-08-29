'use client';
import { useEffect, useRef, useState } from 'react';
import { useOfferInbox } from '@/lib/offerInboxClient';
import OfferInboxPanel from './OfferInboxPanel';

/**
 * Popup « Nouvelles offres reçues », montée pour toute l'application.
 *
 * Dès que l'automatisation (N8N) pousse un nouveau lot sur
 * /api/webhooks/job-offers, elle s'ouvre d'elle-même et propose de cocher les
 * offres à importer. « Plus tard » la referme jusqu'au prochain lot — le tri
 * reste accessible à tout moment depuis la page « Offres reçues ».
 */

// Lots déjà repoussés, mémorisés le temps de la session de navigation : on ne
// rouvre pas la popup à chaque changement de page pour un lot déjà écarté du
// regard, mais un nouvel envoi la rouvre.
const DISMISS_KEY = 'crmDismissedOfferInboxes';

function readDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISS_KEY) || '[]');
  } catch {
    return [];
  }
}

export default function NewOffersModal() {
  const { inboxes, loading } = useOfferInbox();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [closed, setClosed] = useState(false);
  // Une fois ouverte, la popup RESTE affichée jusqu'à ce que l'utilisateur la
  // ferme : le tri vide la boîte de réception, et sans cela le récapitulatif de
  // fin d'import disparaîtrait à la seconde où il s'affiche.
  const [opened, setOpened] = useState(false);

  useEffect(() => { setDismissed(readDismissed()); }, []);

  // Lots jamais repoussés : c'est ce qui déclenche l'ouverture. Le composant
  // n'est monté que dans AppLayout, donc uniquement une fois l'écran de
  // connexion franchi : rien à vérifier de plus côté identité.
  const fresh = inboxes.filter(i => !dismissed.includes(i.id));

  // Un nouveau lot arrive (y compris après un « Plus tard ») : la popup s'ouvre.
  useEffect(() => {
    if (fresh.length > 0) { setOpened(true); setClosed(false); }
  }, [fresh.length]);

  // Nombre affiché en titre : figé pendant le tri, sinon il tomberait à zéro
  // dès que les offres quittent la boîte de réception.
  const liveCount = fresh.reduce((n, i) => n + i.offers.length, 0);
  const shownCount = useRef(0);
  if (liveCount > 0) shownCount.current = liveCount;

  const close = () => { setClosed(true); setOpened(false); };

  if (loading || closed || !opened) return null;

  const offerCount = shownCount.current;

  const dismiss = () => {
    const next = Array.from(new Set([...dismissed, ...fresh.map(i => i.id)]));
    setDismissed(next);
    close();
    try { sessionStorage.setItem(DISMISS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={dismiss}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 14, width: 'min(1100px, 100%)', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', padding: '18px 22px 20px',
          boxShadow: '0 20px 60px rgba(15,23,42,.35)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
          <div style={{ fontSize: 26 }}>📨</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {offerCount} nouvelle{offerCount > 1 ? 's' : ''} offre{offerCount > 1 ? 's' : ''} reçue{offerCount > 1 ? 's' : ''}
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              Cochez celles à importer dans le CRM. Les autres seront écartées.
            </div>
          </div>
          <button
            onClick={dismiss}
            title="Plus tard"
            style={{ border: 'none', background: 'none', fontSize: 20, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <OfferInboxPanel
          inboxes={fresh}
          onDone={() => {
            close();
            // Les écrans du CRM (pipeline, dashboard…) chargent leurs données
            // côté navigateur : un rechargement est le seul moyen fiable d'y
            // faire apparaître les affaires qui viennent d'être importées.
            window.location.reload();
          }}
          onDismiss={dismiss}
        />
      </div>
    </div>
  );
}
