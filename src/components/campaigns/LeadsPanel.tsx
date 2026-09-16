'use client';
// src/components/campaigns/LeadsPanel.tsx
//
// Écran « Leads » de l'onglet Campagnes : la liste de tous les contacts
// prospectés, filtrable par statut et par recherche, avec ouverture de la
// fiche sur le côté pour le suivi un par un.

import { useCallback, useEffect, useState } from 'react';
import { useCurrentUser } from '@/lib/currentUser';
import { LEAD_STATUSES, statusColor, statusLabel } from '@/lib/campaigns/leadFields';
import LeadDrawer, { type LeadRow } from './LeadDrawer';
import LeadFormModal from './LeadFormModal';
import LeadImportModal from './LeadImportModal';
import { btnDef, btnPri, inp } from './ui';


export default function LeadsPanel() {
  const { user } = useCurrentUser();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set('status', status);
      if (search) params.set('q', search);
      const res = await fetch(`/api/campaigns/leads?${params}`);
      const data = await res.json();
      setLeads(data.leads || []);
      setCounts(data.statusCounts || {});
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } finally {
      setLoading(false);
    }
  }, [page, status, search]);

  useEffect(() => { load(); }, [load]);

  // Recherche différée : on n'interroge pas le serveur à chaque frappe.
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const totalAll = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '18px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <input style={{ ...inp, width: 280 }} placeholder="Rechercher (email, nom, enseigne…)"
            value={query} onChange={e => setQuery(e.target.value)} />
          <div style={{ fontSize: 12, color: '#9aa1b4' }}>{total} lead{total > 1 ? 's' : ''}</div>
          <button style={{ ...btnDef, marginLeft: 'auto' }} onClick={() => setCreating(true)}>+ Nouveau lead</button>
          <button style={btnPri} onClick={() => setImporting(true)}>+ Importer un CSV</button>
        </div>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 14 }}>
          <FilterChip label="Tous" count={totalAll} active={!status} color="#3b71f5"
            onClick={() => { setStatus(''); setPage(1); }} />
          {LEAD_STATUSES.map(item => (
            <FilterChip key={item.key} label={item.label} count={counts[item.key] || 0}
              active={status === item.key} color={item.color}
              onClick={() => { setStatus(item.key); setPage(1); }} />
          ))}
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: '#6b7283' }}>Chargement…</div>
        ) : leads.length === 0 ? (
          <div style={{ background: '#171a23', border: '1px dashed #333a4a', borderRadius: 12, padding: 28, textAlign: 'center', color: '#9aa1b4', fontSize: 13 }}>
            {search || status ? 'Aucun lead ne correspond à ce filtre.' : 'Aucun lead pour l\'instant — importez un fichier pour commencer.'}
          </div>
        ) : (
          <div style={{ background: '#171a23', border: '1px solid #262b38', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#1c1f2a', textAlign: 'left', color: '#9aa1b4' }}>
                  <th style={th}>Contact</th>
                  <th style={th}>Enseigne</th>
                  <th style={th}>Poste</th>
                  <th style={th}>Ville</th>
                  <th style={th}>Statut</th>
                  <th style={th}>Dernier contact</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <tr key={lead.id} onClick={() => setSelected(lead.id)}
                    style={{ borderTop: '1px solid #222634', cursor: 'pointer', background: selected === lead.id ? 'rgba(59,113,245,.16)' : undefined }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>
                        {[lead.civility, lead.firstName, lead.lastName].filter(Boolean).join(' ') || '—'}
                      </div>
                      <div style={{ color: '#6b7283', fontSize: 11.5 }}>{lead.email}</div>
                    </td>
                    <td style={td}>{lead.company || '—'}</td>
                    <td style={td}>{lead.jobTitle || '—'}</td>
                    <td style={td}>{lead.city || '—'}</td>
                    <td style={td}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                        color: statusColor(lead.status), background: `${statusColor(lead.status)}18`,
                      }}>{statusLabel(lead.status)}</span>
                    </td>
                    <td style={{ ...td, color: '#6b7283' }}>
                      {lead.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleDateString('fr-FR') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <button style={btnDef} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Précédent</button>
            <span style={{ fontSize: 12, color: '#9aa1b4' }}>Page {page} / {pages}</span>
            <button style={btnDef} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Suivant</button>
          </div>
        )}
      </div>

      {selected && (
        <LeadDrawer
          leadId={selected}
          userName={user?.name}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}

      {importing && (
        <LeadImportModal userName={user?.name} onClose={() => setImporting(false)} onDone={load} />
      )}

      {creating && (
        <LeadFormModal userName={user?.name} onClose={() => setCreating(false)} onSaved={load} />
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: '9px 12px', fontWeight: 600, fontSize: 11.5 };
const td: React.CSSProperties = { padding: '9px 12px' };

function FilterChip({ label, count, active, color, onClick }: {
  label: string; count: number; active: boolean; color: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 12,
      fontWeight: active ? 700 : 500,
      border: `1px solid ${active ? color : '#262b38'}`,
      background: active ? `${color}18` : '#171a23',
      color: active ? color : '#9aa1b4',
    }}>
      {label} <span style={{ opacity: 0.7 }}>{count}</span>
    </button>
  );
}
