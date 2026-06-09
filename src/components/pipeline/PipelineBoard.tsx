'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import type { Deal, PipelineColumn, Brand } from '@/types';
import DealCard from './DealCard';
import DealDrawer from '@/components/deal/DealDrawer';
import CreateDealModal from './CreateDealModal';
import { toast } from '@/components/ui/Toast';

interface Collaborator { id: string; name: string; color: string; }
interface Pipeline { id: string; name: string; columns: PipelineColumn[]; }
interface Props { initialDeals: Deal[]; columns: PipelineColumn[]; }

export default function PipelineBoard({ initialDeals, columns }: Props) {
  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
  const [selectedDeal, setSelected] = useState<Deal | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [filterNew, setFilterNew] = useState(false);
  const [filterOffer, setOffer] = useState(false);
  const [filterBrand, setFilterBrand] = useState('');
  const [filterCollab, setFilterCollab] = useState('');
  const [loading, setLoading] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const dragDeal = useRef<Deal | null>(null);

  // Save pipeline selection to localStorage
  useEffect(() => {
    if (selectedPipelineId) {
      localStorage.setItem('selectedPipelineId', selectedPipelineId);
    }
  }, [selectedPipelineId]);

  // Load pipelines on mount
  useEffect(() => {
    fetch('/api/pipelines')
      .then(r => r.json())
      .then(data => {
        setPipelines(data.pipelines || []);
        // Utilise localStorage si disponible, sinon le premier pipeline
        const saved = localStorage.getItem('selectedPipelineId');
        if (saved) {
          setSelectedPipelineId(saved);
        } else if (data.pipelines && data.pipelines.length > 0) {
          setSelectedPipelineId(data.pipelines[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const fetchDeals = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search)       params.set('search', search);
      if (filterNew)    params.set('newOnly', 'true');
      if (filterOffer)  params.set('newOffer', 'true');
      if (filterBrand)  params.set('brandId', filterBrand);
      if (filterCollab) params.set('collaboratorId', filterCollab);
      if (selectedPipelineId) params.set('pipelineId', selectedPipelineId);
      const res = await fetch(`/api/deals?${params}`);
      if (res.ok) setDeals(await res.json());
    } finally { setLoading(false); }
  }, [search, filterNew, filterOffer, filterBrand, filterCollab, selectedPipelineId]);

  // Recharger les affaires quand le pipeline change
  useEffect(() => {
    if (selectedPipelineId) {
      fetchDeals();
    }
  }, [selectedPipelineId, fetchDeals]);

  // Recharger périodiquement
  useEffect(() => {
    const interval = setInterval(fetchDeals, 30000);
    return () => clearInterval(interval);
  }, [fetchDeals]);

  useEffect(() => {
    fetch('/api/brands').then(r => r.json()).then(setBrands).catch(() => {});
    fetch('/api/collaborators').then(r => r.json()).then(setCollaborators).catch(() => {});
  }, []);

  const currentPipeline = pipelines.find(p => p.id === selectedPipelineId);
  const pipelineColumns = (currentPipeline?.columns || []).sort((a, b) => a.position - b.position);

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

  const sortedCols = pipelineColumns;
  const dealsForCol = (colId: string) => deals.filter(d => d.columnId === colId).sort((a, b) => a.position - b.position);

  const selStyle = (active: boolean, color = '#4f46e5'): React.CSSProperties => ({
    padding: '4px 8px', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer',
    border: '1px solid', background: active ? color : '#fff',
    color: active ? '#fff' : '#475569', borderColor: active ? color : '#e2e8f0',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 16px', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 700, marginRight: 4 }}>Pipeline</span>

        {pipelines.length > 0 && (
          <select value={selectedPipelineId} onChange={e => setSelectedPipelineId(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', fontSize: 12, color: '#475569', cursor: 'pointer', outline: 'none' }}>
            {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        <input style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 12, width: 160, outline: 'none' }}
          placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} />

        <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}
          style={{ padding: '4px 8px', borderRadius: 7, border: '1px solid #e2e8f0', background: filterBrand ? '#eef2ff' : '#fff', fontSize: 12, color: filterBrand ? '#4338ca' : '#475569', cursor: 'pointer', outline: 'none' }}>
          <option value="">Toutes enseignes</option>
          {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        <select value={filterCollab} onChange={e => setFilterCollab(e.target.value)}
          style={{ padding: '4px 8px', borderRadius: 7, border: '1px solid #e2e8f0', background: filterCollab ? '#eef2ff' : '#fff', fontSize: 12, color: filterCollab ? '#4338ca' : '#475569', cursor: 'pointer', outline: 'none' }}>
          <option value="">Tous collaborateurs</option>
          {collaborators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <button style={selStyle(filterNew)} onClick={() => setFilterNew(!filterNew)}>✦ Nouvelles</button>
        <button style={selStyle(filterOffer, '#f59e0b')} onClick={() => setOffer(!filterOffer)}>⟳ Nouvelle offre</button>
        <button onClick={fetchDeals} style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', fontSize: 12, cursor: 'pointer' }}>
          {loading ? '⟳' : '↺'} Rafraîchir
        </button>

        <button onClick={() => setShowCreate(true)}
          style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          + Nouvelle affaire
        </button>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{deals.length} affaire{deals.length > 1 ? 's' : ''}</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {sortedCols.map(col => {
          const colDeals = dealsForCol(col.id);
          return (
            <div key={col.id} style={{
              background: dragOverCol === col.id ? '#eef2ff' : '#f1f5f9', borderRadius: 10,
              width: 230, flexShrink: 0, display: 'flex', flexDirection: 'column',
              border: `1px solid ${dragOverCol === col.id ? '#6366f1' : '#e2e8f0'}`,
              maxHeight: 'calc(100vh - 110px)',
              outline: dragOverCol === col.id ? '2px dashed #6366f1' : 'none',
            }}
              onDragOver={e => onDragOver(e, col.id)}
              onDrop={e => onDrop(e, col.id)}
              onDragLeave={() => setDragOverCol(null)}>
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
      {showCreate && <CreateDealModal columns={pipelineColumns} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); fetchDeals(); }} />}
    </div>
  );
}
