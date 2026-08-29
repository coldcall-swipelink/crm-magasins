'use client';
import { useEffect, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import OfferInboxPanel from '@/components/import/OfferInboxPanel';
import { useOfferInbox } from '@/lib/offerInboxClient';
import type { OfferInboxHistoryEntry } from '@/types';
import { formatDate } from '@/lib/utils';

/**
 * Page « Offres reçues » : le tri des offres poussées par l'automatisation,
 * accessible à tout moment (la popup, elle, ne s'ouvre qu'à l'arrivée d'un
 * lot). Affiche aussi les derniers lots déjà tranchés, pour vérifier que
 * l'automatisation tourne bien.
 */
export default function OffresRecuesPage() {
  const { inboxes, loading, refresh } = useOfferInbox();
  const [history, setHistory] = useState<OfferInboxHistoryEntry[]>([]);

  const loadHistory = () => {
    fetch('/api/offer-inbox?history=1')
      .then(r => r.json())
      .then(d => setHistory(d.history || []))
      .catch(() => {});
  };

  useEffect(() => { loadHistory(); }, []);

  const pendingOffers = inboxes.reduce((n, i) => n + i.offers.length, 0);

  return (
    <AppLayout>
      <div style={{ padding: 24, maxWidth: 1100, display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Offres reçues</div>
          <button
            onClick={() => { refresh(); loadHistory(); }}
            style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#334155', fontSize: 12, cursor: 'pointer' }}
          >
            ⟳ Actualiser
          </button>
        </div>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 10 }}>
          Offres poussées automatiquement dans le CRM (N8N). Rien n&apos;entre dans le pipeline sans
          votre tri : cochez ce qui doit être importé.
        </p>

        {loading && pendingOffers === 0
          ? <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Chargement…</div>
          : <OfferInboxPanel inboxes={inboxes} onDone={loadHistory} />}

        {/* Derniers lots tranchés — contrôle de bon fonctionnement de l'automatisation. */}
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Lots déjà traités</div>
          {history.length === 0 ? (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Aucun lot traité pour l&apos;instant.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {history.map(h => (
                <div key={h.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{h.label || 'Offres reçues'}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      Reçu le {formatDate(h.receivedAt)}
                      {h.processedAt && ` · trié le ${formatDate(h.processedAt)}`}
                      {h.processedBy && ` par ${h.processedBy}`}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                    {h.newRows} offre(s)
                    {h.duplicateRows > 0 && ` · ${h.duplicateRows} doublon(s)`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
