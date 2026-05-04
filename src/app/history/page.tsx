'use client';
// src/app/history/page.tsx
import { useEffect, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import type { ImportBatch } from '@/types';
import { formatDate } from '@/lib/utils';
import { ChevronDown, ChevronRight, History } from 'lucide-react';

export default function HistoryPage() {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/import-batches').then(r => r.json()).then(setBatches);
  }, []);

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="flex items-center gap-2 mb-6">
          <History size={20} className="text-slate-400" />
          <h1 className="text-xl font-bold text-slate-900">Historique des imports</h1>
        </div>

        {batches.length === 0 && (
          <div className="text-center py-20 text-slate-400">
            <History size={40} className="mx-auto mb-3 opacity-30" />
            <p>Aucun import encore. Allez dans <strong>Importer CSV</strong> pour commencer.</p>
          </div>
        )}

        <div className="space-y-3">
          {batches.map(b => (
            <div key={b.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {/* Résumé */}
              <button
                className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors"
                onClick={() => setExpanded(expanded === b.id ? null : b.id)}
              >
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium text-slate-800">{b.fileName}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {formatDate(b.importedAt)} · {b.totalRows} lignes
                  </div>
                </div>
                <div className="flex gap-4 text-xs">
                  {b.createdDeals > 0 && <span className="text-emerald-600 font-medium">+{b.createdDeals} créées</span>}
                  {b.updatedDeals > 0 && <span className="text-slate-500">⟳{b.updatedDeals} màj</span>}
                  {b.newOffers > 0    && <span className="text-amber-600">✦{b.newOffers} offres</span>}
                  {(b.movedToCall || 0) > 0 && <span className="text-indigo-600">↩{b.movedToCall} rappelées</span>}
                  {b.disappearedOffers > 0 && <span className="text-red-500">✗{b.disappearedOffers} disparues</span>}
                  {b.errorCount > 0        && <span className="text-red-500">⚠{b.errorCount} err.</span>}
                </div>
                {expanded === b.id ? <ChevronDown size={16} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />}
              </button>

              {/* Détail lignes */}
              {expanded === b.id && b.importRows && (
                <div className="border-t border-slate-200 overflow-auto max-h-80">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        {['#', 'Statut', 'Magasin', 'Message'].map(h => (
                          <th key={h} className="px-4 py-2 text-left text-slate-500 font-medium border-b border-slate-200">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {b.importRows.map(row => (
                        <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-4 py-2 text-slate-400 font-mono">{row.rowNumber}</td>
                          <td className="px-4 py-2">
                            <span className={`badge text-[10px] ${row.status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-slate-700">{row.store?.name || '—'}</td>
                          <td className="px-4 py-2 text-slate-400">{row.errorMessage || 'OK'}</td>
                        </tr>
                      ))}
                    </tbody>
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
