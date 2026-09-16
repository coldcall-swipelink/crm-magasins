'use client';
// src/components/campaigns/OfferTriggerJournal.tsx
//
// Ce qu'une règle a fait, offre par offre.
//
// Les non-inscriptions comptent autant que les inscriptions : « l'affaire n'a
// pas d'adresse email », « déjà inscrit », « désinscrit ». Sans elles, une
// règle qui ne part pas se regarde sans rien comprendre — et c'est justement
// le moment où l'on a besoin de savoir.

import { useEffect, useState } from 'react';
import { T, btnDef, modal, overlay } from './ui';

type Hit = {
  id: string;
  jobOfferId: string;
  dealId: string;
  leadId: string | null;
  outcome: string;
  reason: string;
  offerTitle: string;
  storeName: string;
  createdAt: string;
};

type Lead = { id: string; email: string; civility: string | null; lastName: string | null; company: string | null };

const OUTCOMES: Record<string, { label: string; color: string }> = {
  enrolled:     { label: 'Inscrit',              color: '#4ade80' },
  lead_created: { label: 'Lead créé et inscrit', color: '#2dd4bf' },
  skipped:      { label: 'Non inscrit',          color: '#fbbf24' },
  failed:       { label: 'Échec',                color: '#f87171' },
};

export default function OfferTriggerJournal({ triggerId, onClose }: {
  triggerId: string;
  onClose: () => void;
}) {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [leads, setLeads] = useState<Record<string, Lead>>({});
  const [name, setName] = useState('');

  useEffect(() => {
    fetch(`/api/campaigns/offer-triggers/${triggerId}`)
      .then(res => res.json())
      .then(data => {
        setHits(data.trigger?.hits || []);
        setName(data.trigger?.name || '');
        setLeads(Object.fromEntries((data.leads || []).map((lead: Lead) => [lead.id, lead])));
      })
      .catch(() => setHits([]));
  }, [triggerId]);

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={event => event.stopPropagation()}
        style={{ ...modal, width: 'min(820px, 100%)', maxHeight: '88vh', overflow: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
          Journal — {name}
        </div>
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 16 }}>
          Chaque offre passée devant la règle, et ce qui en est sorti. Une offre n&apos;apparaît
          qu&apos;une fois : elle ne peut pas inscrire deux fois.
        </div>

        {!hits ? (
          <div style={{ fontSize: 13, color: T.textFaint }}>Chargement…</div>
        ) : hits.length === 0 ? (
          <div style={{
            background: T.surfaceAlt, border: `1px dashed ${T.border}`, borderRadius: 10,
            padding: 22, fontSize: 12.5, color: T.textMuted, lineHeight: 1.7,
          }}>
            Cette règle n&apos;a encore rien traité. C&apos;est normal si aucune offre correspondante
            n&apos;est sortie depuis sa création — elle ne regarde pas l&apos;historique tant qu&apos;on
            ne le lui demande pas.
          </div>
        ) : (
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
            {hits.map(hit => {
              const outcome = OUTCOMES[hit.outcome] || { label: hit.outcome, color: T.textMuted };
              const lead = hit.leadId ? leads[hit.leadId] : null;
              return (
                <div key={hit.id} style={{
                  padding: '9px 13px', borderBottom: `1px solid ${T.borderSoft}`,
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700,
                    color: outcome.color, background: `${outcome.color}18`,
                    whiteSpace: 'nowrap', marginTop: 1,
                  }}>{outcome.label}</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: T.text }}>
                      {hit.offerTitle || '(sans intitulé)'}
                      {hit.storeName && <span style={{ color: T.textFaint }}> · {hit.storeName}</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 2 }}>
                      {lead
                        ? `${[lead.civility, lead.lastName].filter(Boolean).join(' ') || lead.email} · ${lead.email}`
                        : hit.reason || '—'}
                      {lead && hit.reason && <span style={{ color: '#fbbf24' }}> · {hit.reason}</span>}
                    </div>
                  </div>

                  <div style={{ fontSize: 11, color: T.textFaint, whiteSpace: 'nowrap' }}>
                    {new Date(hit.createdAt).toLocaleString('fr-FR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', marginTop: 16 }}>
          <button style={{ ...btnDef, marginLeft: 'auto' }} onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
