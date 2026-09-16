'use client';
// src/components/campaigns/CampaignLeadsTab.tsx
//
// Les leads d'une campagne, et leur pilotage UN PAR UN : mettre en pause,
// reprendre ou arrêter la séquence d'un seul lead sans toucher aux autres ni
// à la campagne.
//
// Trois façons d'ajouter des leads, parce que les trois usages existent :
//   • depuis les leads déjà en base, en cochant (ou d'un bloc par recherche) ;
//   • à la main, pour le contact qu'on vient d'avoir au téléphone ;
//   • par fichier CSV, importé ET inscrit dans la foulée.

import { useCallback, useEffect, useState } from 'react';
import { useCurrentUser } from '@/lib/currentUser';
import { toast } from '@/components/ui/Toast';
import LeadFormModal from './LeadFormModal';
import LeadImportModal from './LeadImportModal';
import LeadPickerModal from './LeadPickerModal';
import { ENROLLMENT_STATUS, STOP_REASONS, btnDef, btnPri, btnXs } from './ui';

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
  // Quelle fenêtre d'ajout est ouverte : aucune, le choix parmi les leads
  // existants, la saisie manuelle, ou l'import de fichier.
  const [adding, setAdding] = useState<'pick' | 'manual' | 'import' | null>(null);

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
          active={!status} color="#3b71f5" onClick={() => { setStatus(''); setPage(1); }} />
        {Object.entries(ENROLLMENT_STATUS).map(([key, item]) => (
          <Chip key={key} label={item.label} count={counts[key] || 0} active={status === key}
            color={item.color} onClick={() => { setStatus(key); setPage(1); }} />
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button style={btnPri} onClick={() => setAdding('pick')}>+ Depuis mes leads</button>
          <button style={btnDef} onClick={() => setAdding('manual')}>+ Nouveau lead</button>
          <button style={btnDef} onClick={() => setAdding('import')}>+ Importer un CSV</button>
        </div>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: '#6b7283' }}>Chargement…</div>
      ) : enrollments.length === 0 ? (
        <div style={{ background: '#171a23', border: '1px dashed #333a4a', borderRadius: 12, padding: 28, textAlign: 'center', color: '#9aa1b4', fontSize: 13 }}>
          {status ? 'Aucun lead dans cet état.' : 'Aucun lead inscrit. Ajoutez-en pour que la campagne ait de quoi travailler.'}
        </div>
      ) : (
        <div style={{ background: '#171a23', border: '1px solid #262b38', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#1c1f2a', textAlign: 'left', color: '#9aa1b4' }}>
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
                const state = ENROLLMENT_STATUS[enrollment.status] || { label: enrollment.status, color: '#9aa1b4' };
                const last = enrollment.messages[0];
                return (
                  <tr key={enrollment.id} style={{ borderTop: '1px solid #222634' }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>
                        {[enrollment.lead.firstName, enrollment.lead.lastName].filter(Boolean).join(' ') || enrollment.lead.email}
                      </div>
                      <div style={{ color: '#6b7283', fontSize: 11.5 }}>
                        {enrollment.lead.email}{enrollment.lead.company ? ` · ${enrollment.lead.company}` : ''}
                      </div>
                    </td>
                    <td style={td}>
                      {enrollment.sentSteps === 0 ? <span style={{ color: '#6b7283' }}>rien envoyé</span> : (
                        <span>
                          {enrollment.sentSteps} email{enrollment.sentSteps > 1 ? 's' : ''}
                          {last?.openedAt && <span title="Ouvert"> · 👁️</span>}
                          {last?.repliedAt && <span title="A répondu"> · 💬</span>}
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, color: '#9aa1b4', fontSize: 11.5 }}>{enrollment.mailbox?.email || '—'}</td>
                    <td style={{ ...td, color: '#9aa1b4' }}>
                      {enrollment.nextSendAt
                        ? new Date(enrollment.nextSendAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </td>
                    <td style={td}>
                      <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: state.color, background: `${state.color}18` }}>
                        {state.label}
                      </span>
                      {enrollment.stopReason && (
                        <div style={{ fontSize: 10.5, color: '#6b7283', marginTop: 2 }}>
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
                          <button style={{ ...btnXs, borderColor: 'rgba(239,68,68,.35)', background: 'rgba(239,68,68,.13)', color: '#f87171' }}
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
        <div style={{ fontSize: 12, color: '#9aa1b4' }}>{total} lead{total > 1 ? 's' : ''} dans la campagne</div>
        {pages > 1 && (
          <>
            <button style={{ ...btnDef, marginLeft: 'auto' }} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Précédent</button>
            <span style={{ fontSize: 12, color: '#9aa1b4' }}>Page {page} / {pages}</span>
            <button style={btnDef} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Suivant</button>
          </>
        )}
      </div>

      {adding === 'pick' && (
        <LeadPickerModal campaignId={campaignId} onClose={() => setAdding(null)}
          onDone={() => { load(); onChanged(); }} />
      )}
      {adding === 'manual' && (
        <LeadFormModal campaignId={campaignId} userName={user?.name} onClose={() => setAdding(null)}
          onSaved={() => { load(); onChanged(); }} />
      )}
      {adding === 'import' && (
        <LeadImportModal campaignId={campaignId} userName={user?.name} onClose={() => setAdding(null)}
          onDone={() => { load(); onChanged(); }} />
      )}
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
      border: `1px solid ${active ? color : '#262b38'}`,
      background: active ? `${color}18` : '#171a23',
      color: active ? color : '#9aa1b4',
    }}>{text} <span style={{ opacity: 0.7 }}>{count}</span></button>
  );
}
