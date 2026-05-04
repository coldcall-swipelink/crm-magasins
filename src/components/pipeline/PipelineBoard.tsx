'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import type { Deal, PipelineColumn } from '@/types';
import DealCard from './DealCard';
import DealDrawer from '@/components/deal/DealDrawer';
import { toast } from '@/components/ui/Toast';

interface Props { initialDeals: Deal[]; columns: PipelineColumn[]; }

export default function PipelineBoard({ initialDeals, columns }: Props) {
  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  const [selectedDeal, setSelected] = useState<Deal | null>(null);
  const [search, setSearch] = useState('');
  const [filterNew, setFilterNew] = useState(false);
  const [filterOffer, setOffer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const dragDeal = useRef<Deal | null>(null);

  const fetchDeals = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterNew) params.set('newOnly', 'true');
      if (filterOffer) params.set('newOffer', 'true');
      const res = await fetch(`/api/deals?${params}`);
      if (res.ok) setDeals(await res.json());
    } finally { setLoading(false); }
  }, [search, filterNew, filterOffer]);

  useEffect(() => { fetchDeals(); }, [fetchDeals]);

  const onDragStart = (e: React.DragEvent, deal: Deal) => { dragDeal.current = deal; setDraggingId(deal.id); e.dataTransfer.effectAllowed = 'move'; };
  const onDragEnd = () => { setDraggingId(null); setDragOverCol(null); };
  const onDragOver = (e: React.DragEvent, colId: string) => { e.preventDefault(); setDragOverCol(colId); };
  const onDrop = async (e: React.DragEvent, targetColId: string) => {
    e.preventDefault();
    const deal = dragDeal.current;
    if (!deal || deal.columnId === targetColId) { onDragEnd(); return; }
    setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, columnId: targetColId } : d));
    onDragEnd();
    try {
      const res = await fetch(`/api/deals/${deal.id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columnId: targetColId }) });
      if (!res.ok) throw new Error();
    } catch { toast('Erreur déplacement', 'error'); fetchDeals(); }
  };

  const sortedCols = [...columns].sort((a, b) => a.position - b.position);
  const dealsForCol = (colId: string) => deals.filter(d => d.columnId === colId).sort((a, b) => a.position - b.position);
  const newOfferCount = deals.filter(d => d.hasNewOfferFromLastImport && !d.isNewFromLastImport).length;

  const btnStyle = (active: boolean, warn?: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', borderRadius: 7, fontSize: 12, fontWeight: 500,
    cursor: 'pointer', border: '1px solid',
    background: active ? (warn ? '#f59e0b' : '#4f46e5') : '#fff',
    color: active ? '#fff' : '#475569',
    borderColor: active ? (warn ? '#f59e0b' : '#4f46e5') : '#e2e8f0',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{ padding: '8px 16px', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 700, marginRight: 4 }}>Pipeline</span>
        <input style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 12, width: 180, outline: 'none' }} placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} />
        <button style={btnStyle(filterNew)} onClick={() => setFilterNew(!filterNew)}>✦ Nouvelles</button>
        <button style={btnStyle(filterOffer, true)} onClick={() => setOffer(!filterOffer)}>
          ⟳ Nouvelle offre {newOfferCount > 0 && <span style={{ background: '#f59e0b', color: '#fff', borderRadius: 3, padding: '0 4px', fontSize: 10 }}>{newOfferCount}</span>}
        </button>
        <button onClick={fetchDeals} style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          {loading ? '⟳' : '↺'} Rafraîchir
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>{deals.length} affaire{deals.length > 1 ? 's' : ''}</span>
      </div>

      {/* Board */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 'max-content' }}>
        {sortedCols.map(col => {
          const colDeals = dealsForCol(col.id);
          return (
            <div key={col.id} style={{ background: dragOverCol === col.id ? '#eef2ff' : '#f1f5f9', borderRadius: 10, width: 225, flexShrink: 0, display: 'flex', flexDirection: 'column', border: `1px solid ${dragOverCol === col.id ? '#6366f1' : '#e2e8f0'}`, maxHeight: 'calc(100vh - 100px)', outline: dragOverCol === col.id ? '2px dashed #6366f1' : 'none' }}
              onDragOver={e => onDragOver(e, col.id)} onDrop={e => onDrop(e, col.id)} onDragLeave={() => setDragOverCol(null)}>
              <div style={{ padding: '8px 10px 6px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: 11, flex: 1, color: '#374151' }}>{col.title}</span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{colDeals.length}</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 5, minHeight: 50 }}>
                {colDeals.map(deal => (
                  <DealCard key={deal.id} deal={deal} isDragging={draggingId === deal.id}
                    onDragStart={e => onDragStart(e, deal)} onDragEnd={onDragEnd} onSelect={() => setSelected(deal)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {selectedDeal && <DealDrawer dealId={selectedDeal.id} onClose={() => setSelected(null)} onUpdated={fetchDeals} />}
    </div>
  );
}
