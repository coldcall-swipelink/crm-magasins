'use client';
// src/components/campaigns/CampaignLeadsTab.tsx
//
// Les leads d'une campagne, et leur pilotage UN PAR UN : mettre en pause,
// reprendre ou arrêter la séquence d'un seul lead sans toucher aux autres ni
// à la campagne.
//
// L'ajout de leads reprend la recherche de l'écran Leads : on filtre, on voit
// combien de contacts correspondent, on inscrit.

import { useCallback, useEffect, useState } from 'react';
import { useCurrentUser } from '@/lib/currentUser';
import { toast } from '@/components/ui/Toast';
import { LEAD_STATUSES } from '@/lib/campaigns/leadFields';
import { ENROLLMENT_STATUS, STOP_REASONS, btnDef, btnPri, btnXs, card, inp, label } from './ui';

type Enrollment = {
  id: string;
  status: string;
  stopReason: string | null;
  sentSteps: number;
  nextSendAt: string | null;
  lead: { id: string; email: string; civility: string | null; firstName: string | null; lastName: string | null; company: string | null; status: string };
  mailbox: { email: string } | null;
  messages: Array<{ sentAt: string; openedAt: string | null; repliedAt: string | null; stepPosition: number }>;
};

export default function CampaignLeadsTab({ campaignId, onChanged }: {
  campaignId: string;
  onChanged: () => void;
}) {
  const { user } = useCurrentUser();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set('status', status);
      const res = await fetch(`/api/campaigns/${campaignId}/enrollments?${params}`);
      const data = await res.json();
      setEnrollments(data.enrollments || []);
      setCounts(data.statusCounts || {});
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } finally {
      setLoading(false);
    }
  }, [campaignId, page, status]);

  useEffect(() => { load(); }, [load]);

  const act = async (enrollment: Enrollment, action: 'pause' | 'resume' | 'stop') => {
    const res = await fetch(`/api/campaigns/${campaignId}/enrollments/${enrollment.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, userName: user?.name }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Action impossible', 'error'); return; }
    load();
    onChanged();
  };

  return (
    <div style={{ padding: '18px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <Chip label="Tous" count={Object.values(counts).reduce((sum, n) => sum + n, 0)}
          active={!status} color="#4f46e5" onClick={() => { setStatus(''); setPage(1); }} />
        {Object.entries(ENROLLMENT_STATUS).map(([key, item]) => (
          <Chip key={key} label={item.label} count={counts[key] || 0} active={status === key}
            color={item.color} onClick={() => { setStatus(key); setPage(1); }} />
        ))}
        <button style={{ ...btnPri, marginLeft: 'auto' }} onClick={() => setAdding(true)}>+ Ajouter des leads</button>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: '#94a3b8' }}>Chargement…</div>
      ) : enrollments.length === 0 ? (
        <div style={{ background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 12, padding: 28, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          {status ? 'Aucun lead dans cet état.' : 'Aucun lead inscrit. Ajoutez-en pour que la campagne ait de quoi travailler.'}
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#f8fafc', textAlign: 'left', color: '#64748b' }}>
                <th style={th}>Lead</th>
                <th style={th}>Avancement</th>
                <th style={th}>Boîte</th>
                <th style={th}>Prochain envoi</th>
                <th style={th}>État</th>
                <th style={{ ...th, width: 190 }}></th>
              </tr>
            </thead>
            <tbody>
              {enrollments.map(enrollment => {
                const state = ENROLLMENT_STATUS[enrollment.status] || { label: enrollment.status, color: '#64748b' };
                const last = enrollment.messages[0];
                return (
                  <tr key={enrollment.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>
                        {[enrollment.lead.firstName, enrollment.lead.lastName].filter(Boolean).join(' ') || enrollment.lead.email}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: 11.5 }}>
                        {enrollment.lead.email}{enrollment.lead.company ? ` · ${enrollment.lead.company}` : ''}
                      </div>
                    </td>
                    <td style={td}>
                      {enrollment.sentSteps === 0 ? <span style={{ color: '#94a3b8' }}>rien envoyé</span> : (
                        <span>
                          {enrollment.sentSteps} email{enrollment.sentSteps > 1 ? 's' : ''}
                          {last?.openedAt && <span title="Ouvert"> · 👁️</span>}
                          {last?.repliedAt && <span title="A répondu"> · 💬</span>}
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, color: '#64748b', fontSize: 11.5 }}>{enrollment.mailbox?.email || '—'}</td>
                    <td style={{ ...td, color: '#64748b' }}>
                      {enrollment.nextSendAt
                        ? new Date(enrollment.nextSendAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </td>
                    <td style={td}>
                      <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: state.color, background: `${state.color}18` }}>
                        {state.label}
                      </span>
                      {enrollment.stopReason && (
                        <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>
                          {STOP_REASONS[enrollment.stopReason] || enrollment.stopReason}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
                        {enrollment.status === 'active' && (
                          <button style={btnXs} onClick={() => act(enrollment, 'pause')}>Pause</button>
                        )}
                        {(enrollment.status === 'paused' || enrollment.status === 'stopped') && (
                          <button style={btnXs} onClick={() => act(enrollment, 'resume')}>Reprendre</button>
                        )}
                        {enrollment.status !== 'stopped' && enrollment.status !== 'finished' && (
                          <button style={{ ...btnXs, borderColor: '#fecaca', background: '#fef2f2', color: '#b91c1c' }}
                            onClick={() => act(enrollment, 'stop')}>Arrêter</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <div style={{ fontSize: 12, color: '#64748b' }}>{total} lead{total > 1 ? 's' : ''} dans la campagne</div>
        {pages > 1 && (
          <>
            <button style={{ ...btnDef, marginLeft: 'auto' }} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Précédent</button>
            <span style={{ fontSize: 12, color: '#64748b' }}>Page {page} / {pages}</span>
            <button style={btnDef} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Suivant</button>
          </>
        )}
      </div>

      {adding && (
        <AddLeadsModal campaignId={campaignId} onClose={() => setAdding(false)}
          onDone={() => { load(); onChanged(); }} />
      )}
    </div>
  );
}

/** Sélection de leads à inscrire, par recherche et par statut. */
function AddLeadsModal({ campaignId, onClose, onDone }: {
  campaignId: string; onClose: () => void; onDone: () => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('new');
  const [matches, setMatches] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Décompte en direct : on sait ce qu'on s'apprête à inscrire.
  useEffect(() => {
    const timer = setTimeout(async () => {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (status) params.set('status', status);
      const res = await fetch(`/api/campaigns/leads?${params}`);
      const data = await res.json();
      setMatches(data.total ?? 0);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, status]);

  const enroll = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/enrollments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter: { q: query.trim() || undefined, status: status || undefined } }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Inscription impossible', 'error'); return; }

      const reasons = Object.entries(data.reasons || {}).map(([reason, count]) => `${count} ${reason}`).join(', ');
      toast(`${data.enrolled} lead(s) inscrit(s)${data.skipped ? ` · ${data.skipped} écarté(s) (${reasons})` : ''}`);
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 24 }}
      onClick={onClose}>
      <div onClick={event => event.stopPropagation()} style={{ ...card, width: 'min(560px, 100%)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Ajouter des leads à la campagne</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
          Les désinscrits, adresses mortes et leads déjà inscrits sont écartés automatiquement.
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={label}>Recherche (email, nom, enseigne…)</label>
          <input style={inp} value={query} onChange={event => setQuery(event.target.value)} placeholder="Laisser vide pour tout prendre" />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={label}>Statut des leads</label>
          <select style={inp} value={status} onChange={event => setStatus(event.target.value)}>
            <option value="">Tous les statuts</option>
            {LEAD_STATUSES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </div>

        <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: '#3730a3', marginBottom: 16 }}>
          {matches === null ? 'Calcul…' : `${matches} lead(s) correspondent à cette sélection.`}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...btnPri, opacity: busy || !matches ? 0.6 : 1 }} disabled={busy || !matches} onClick={enroll}>
            {busy ? 'Inscription…' : 'Inscrire ces leads'}
          </button>
          <button style={btnDef} onClick={onClose}>Annuler</button>
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '9px 12px', fontWeight: 600, fontSize: 11.5 };
const td: React.CSSProperties = { padding: '9px 12px' };

function Chip({ label: text, count, active, color, onClick }: {
  label: string; count: number; active: boolean; color: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 12,
      fontWeight: active ? 700 : 500,
      border: `1px solid ${active ? color : '#e2e8f0'}`,
      background: active ? `${color}18` : '#fff',
      color: active ? color : '#64748b',
    }}>{text} <span style={{ opacity: 0.7 }}>{count}</span></button>
  );
}
