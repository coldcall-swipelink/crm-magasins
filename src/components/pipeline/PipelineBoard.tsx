'use client';
// src/components/pipeline/PipelineBoard.tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import type { Deal, PipelineColumn } from '@/types';
import DealCard from './DealCard';
import DealDrawer from '@/components/deal/DealDrawer';
import { toast } from '@/components/ui/Toast';
import { Plus, RefreshCw, Filter, Search } from 'lucide-react';

interface Props {
  initialDeals:   Deal[];
  columns:        PipelineColumn[];
}

export default function PipelineBoard({ initialDeals, columns }: Props) {
  const [deals, setDeals]           = useState<Deal[]>(initialDeals);
  const [selectedDeal, setSelected] = useState<Deal | null>(null);
  const [search, setSearch]         = useState('');
  const [filterNew, setFilterNew]   = useState(false);
  const [filterOffer, setOffer]     = useState(false);
  const [loading, setLoading]       = useState(false);

  // Drag state
  const [draggingId, setDraggingId]   = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const dragDeal = useRef<Deal | null>(null);

  // ── Chargement ─────────────────────────────────────────────────────────────
  const fetchDeals = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search)      params.set('search', search);
      if (filterNew)   params.set('newOnly', 'true');
      if (filterOffer) params.set('newOffer', 'true');
      const res = await fetch(`/api/deals?${params}`);
      if (res.ok) setDeals(await res.json());
    } finally {
      setLoading(false);
    }
  }, [search, filterNew, filterOffer]);

  useEffect(() => { fetchDeals(); }, [fetchDeals]);

  // ── Drag & Drop ────────────────────────────────────────────────────────────
  const onDragStart = (e: React.DragEvent, deal: Deal) => {
    dragDeal.current = deal;
    setDraggingId(deal.id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragEnd = () => { setDraggingId(null); setDragOverCol(null); };
  const onDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    setDragOverCol(colId);
  };
  const onDrop = async (e: React.DragEvent, targetColId: string) => {
    e.preventDefault();
    const deal = dragDeal.current;
    if (!deal || deal.columnId === targetColId) { onDragEnd(); return; }

    // Optimistic UI
    setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, columnId: targetColId } : d));
    onDragEnd();

    try {
      const res = await fetch(`/api/deals/${deal.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId: targetColId }),
      });
      if (!res.ok) throw new Error('Erreur déplacement');
    } catch {
      toast('Erreur lors du déplacement', 'error');
      fetchDeals(); // rollback
    }
  };

  // ── Filtrages côté client ─────────────────────────────────────────────────
  const sortedCols = [...columns].sort((a, b) => a.position - b.position);

  const dealsForCol = (colId: string) =>
    deals
      .filter(d => d.columnId === colId)
      .sort((a, b) => a.position - b.position);

  return (
    <div className="flex flex-col h-full">
      {/* Barre d'outils */}
      <div className="flex items-center gap-3 px-5 py-3 bg-white border-b border-slate-200 flex-shrink-0">
        <h1 className="text-base font-semibold text-slate-900 mr-2">Pipeline</h1>

        {/* Recherche */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="form-input pl-8 h-8 w-56 text-xs"
            placeholder="Rechercher…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Filtres */}
        <button
          onClick={() => setFilterNew(!filterNew)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
            ${filterNew ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-400'}`}
        >
          <Filter size={12} /> Nouvelles
        </button>
        <button
          onClick={() => setOffer(!filterOffer)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
            ${filterOffer ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 border-slate-200 hover:border-amber-400'}`}
        >
          ⟳ Nouvelle offre
        </button>

        <button onClick={fetchDeals} className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs h-8">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Rafraîchir
        </button>

        <span className="ml-auto text-xs text-slate-400">{deals.length} affaire{deals.length > 1 ? 's' : ''}</span>
      </div>

      {/* Colonnes */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 p-4 h-full items-start min-w-max">
          {sortedCols.map(col => {
            const colDeals = dealsForCol(col.id);
            const isDragTarget = dragOverCol === col.id;
            return (
              <div
                key={col.id}
                className={`kanban-col flex flex-col w-60 max-h-full bg-slate-100 rounded-xl border border-slate-200 flex-shrink-0 transition-all
                  ${isDragTarget ? 'drag-over' : ''}`}
                onDragOver={e => onDragOver(e, col.id)}
                onDrop={e => onDrop(e, col.id)}
                onDragLeave={() => setDragOverCol(null)}
              >
                {/* En-tête colonne */}
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-200">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: col.color }} />
                  <span className="font-medium text-xs text-slate-700 flex-1 truncate">{col.title}</span>
                  <span className="text-xs text-slate-400 font-mono">{colDeals.length}</span>
                </div>

                {/* Cartes */}
                <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2 min-h-20">
                  {colDeals.map(deal => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      isDragging={draggingId === deal.id}
                      onDragStart={e => onDragStart(e, deal)}
                      onDragEnd={onDragEnd}
                      onSelect={() => setSelected(deal)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Drawer détail affaire */}
      {selectedDeal && (
        <DealDrawer
          dealId={selectedDeal.id}
          onClose={() => setSelected(null)}
          onUpdated={fetchDeals}
        />
      )}
    </div>
  );
}
