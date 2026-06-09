'use client';
import { useEffect, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import type { ImportBatch } from '@/types';
import { formatDate } from '@/lib/utils';

export default function HistoryPage() {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => { fetch('/api/import-batches').then(r => r.json()).then(setBatches); }, []);

  return (
    <AppLayout>
      <div style={{ padding: '24px', maxWidth: 900 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Historique des imports</div>
        {!batches.length && <div style={{ color: '#94a3b8', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Aucun import.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {batches.map(b => (
            <div key={b.id} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setExpanded(expanded === b.id ? null : b.id)}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{b.fileName}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{formatDate(b.importedAt)} · {b.totalRows} lignes</div>
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
                  {b.createdDeals > 0 && <span style={{ color: '#16a34a' }}>+{b.createdDeals} créées</span>}
                  {b.updatedDeals > 0 && <span style={{ color: '#64748b' }}>⟳{b.updatedDeals} màj</span>}
                  {b.newOffers > 0 && <span style={{ color: '#d97706' }}>✦{b.newOffers} offres</span>}
                  {(b.movedToCall || 0) > 0 && <span style={{ color: '#6366f1' }}>↩{b.movedToCall} rappelées</span>}
                  {b.errorCount > 0 && <span style={{ color: '#dc2626' }}>⚠{b.errorCount} err.</span>}
                </div>
                <span style={{ color: '#94a3b8' }}>{expanded === b.id ? '▲' : '▼'}</span>
              </div>
              {expanded === b.id && b.importRows && (
                <div style={{ borderTop: '1px solid #e2e8f0', maxHeight: 200, overflow: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead><tr>{['#', 'Statut', 'Magasin', 'Message'].map(h => <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#64748b', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', fontWeight: 500 }}>{h}</th>)}</tr></thead>
                    <tbody>{b.importRows.map(row => (
                      <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '4px 10px', color: '#94a3b8', fontFamily: 'monospace' }}>{row.rowNumber}</td>
                        <td style={{ padding: '4px 10px' }}><span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, fontWeight: 500, background: row.status === 'ok' ? '#dcfce7' : '#fee2e2', color: row.status === 'ok' ? '#15803d' : '#b91c1c' }}>{row.status}</span></td>
                        <td style={{ padding: '4px 10px' }}>{row.store?.name || '—'}</td>
                        <td style={{ padding: '4px 10px', color: '#94a3b8' }}>{row.errorMessage || 'OK'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
