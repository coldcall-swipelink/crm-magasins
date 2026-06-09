'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import type { Deal, PipelineColumn, Brand } from '@/types';
import DealCard from './DealCard';
import DealSearch from './DealSearch';
import DealDrawer from '@/components/deal/DealDrawer';
import CreateDealModal from './CreateDealModal';
import PVModal from './PVModal';
import { toast } from '@/components/ui/Toast';

interface User { id: string; name: string; color: string; }
interface Pipeline { id: string; name: string; color?: string; columns: PipelineColumn[]; }
interface Props { initialDeals: Deal[]; columns: PipelineColumn[]; }

export default function PipelineBoard({ initialDeals, columns }: Props) {
  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filterBrand, setFilterBrand] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [loading, setLoading] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [pv, setPv] = useState<{ dealId: string; targetColId: string; originColId: string } | null>(null);
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
      if (filterBrand) params.set('brandId', filterBrand);
      if (filterUser)  params.set('assignedUserId', filterUser);
      if (selectedPipelineId) params.set('pipelineId', selectedPipelineId);
      const res = await fetch(`/api/deals?${params}`);
      if (res.ok) setDeals(await res.json());
    } finally { setLoading(false); }
  }, [filterBrand, filterUser, selectedPipelineId]);

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
    fetch('/api/users').then(r => r.json()).then(setUsers).catch(() => {});
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
    const originColId = deal.columnId;
    onDragEnd();

    // Affichage optimiste : la carte bascule tout de suite dans la colonne cible.
    setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, columnId: targetColId } : d));

    // Workflow « Prospection de Valeur » : à l'arrivée dans « Démo prévue »
    // (pipeline Prospection), on demande confirmation AVANT de persister, pour
    // pouvoir annuler proprement (Meet + Supabase + duplication ne partent
    // qu'après OUI/NON).
    const targetTitle = pipelineColumns.find(c => c.id === targetColId)?.title;
    if (targetTitle === 'Démo prévue') {
      setPv({ dealId: deal.id, targetColId, originColId });
      return;
    }

    // Autres colonnes : persistance immédiate du déplacement.
    try {
      const res = await fetch(`/api/deals/${deal.id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columnId: targetColId }) });
      if (!res.ok) throw new Error();
    } catch { toast('Erreur déplacement', 'error'); fetchDeals(); }
  };

  // PV confirmée (OUI/NON) : on persiste le déplacement (déclenche Meet +
  // Supabase) puis on duplique l'affaire vers la cible.
  const handlePvConfirm = async (choice: 'oui' | 'non') => {
    if (!pv) return;
    const moveRes = await fetch(`/api/deals/${pv.dealId}/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId: pv.targetColId, pvChoice: choice }),
    });
    if (!moveRes.ok) { toast('Erreur lors du déplacement', 'error'); throw new Error('move'); }

    const dupRes = await fetch(`/api/deals/${pv.dealId}/duplicate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice }),
    });
    const data = await dupRes.json().catch(() => ({}));
    if (!dupRes.ok || !data.ok) { toast(data.error || 'Erreur lors de la duplication', 'error'); throw new Error('dup'); }

    toast(choice === 'oui'
      ? 'Affaire dupliquée dans Recrutement › Sourcing à faire'
      : 'Affaire dupliquée dans Closing › Demo prevue');
    setPv(null);
    fetchDeals();
  };

  // PV annulée : rien n'a été persisté → on remet l'affaire dans sa colonne d'origine.
  const handlePvCancel = () => {
    if (pv) {
      setDeals(prev => prev.map(d => d.id === pv.dealId ? { ...d, columnId: pv.originColId } : d));
    }
    setPv(null);
  };

  const sortedCols = pipelineColumns;
  const dealsForCol = (colId: string) => deals.filter(d => d.columnId === colId).sort((a, b) => a.position - b.position);

  const fieldStyle = (active: boolean): React.CSSProperties => ({
    height: 38, padding: '0 12px', borderRadius: 9, fontSize: 13, cursor: 'pointer', outline: 'none',
    border: `1px solid ${active ? '#c7d2fe' : '#e2e8f0'}`,
    background: active ? '#eef2ff' : '#fff', color: active ? '#4338ca' : '#475569',
    fontWeight: active ? 600 : 400, transition: 'all .12s',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
        {/* Sélection du pipeline — mise en avant, format « onglets » larges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px 0' }}>
          <div style={{ display: 'inline-flex', gap: 4, background: '#f1f5f9', padding: 5, borderRadius: 12 }}>
            {pipelines.map(p => {
              const active = p.id === selectedPipelineId;
              return (
                <button key={p.id} onClick={() => setSelectedPipelineId(p.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 22px', borderRadius: 9, border: 'none', cursor: 'pointer',
                    fontSize: 14.5, fontWeight: 600, transition: 'all .15s',
                    background: active ? '#fff' : 'transparent',
                    color: active ? '#1e293b' : '#64748b',
                    boxShadow: active ? '0 1px 4px rgba(15,23,42,0.12)' : 'none',
                  }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: p.color || '#94a3b8', opacity: active ? 1 : 0.5 }} />
                  {p.name}
                </button>
              );
            })}
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>
            {deals.length} affaire{deals.length > 1 ? 's' : ''}
          </span>
        </div>

        {/* Filtres (gauche) · Recherche (centre) · Actions (droite) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 14px' }}>
          {/* Gauche : filtres */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)} style={fieldStyle(!!filterBrand)}>
              <option value="">Toutes les enseignes</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>

            <select value={filterUser} onChange={e => setFilterUser(e.target.value)} style={fieldStyle(!!filterUser)}>
              <option value="">Tous les utilisateurs</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          {/* Centre : recherche */}
          <DealSearch onSelect={setOpenDealId} />

          {/* Droite : actions */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, minWidth: 0 }}>
            <button onClick={fetchDeals} title="Rafraîchir"
              style={{ height: 38, padding: '0 14px', borderRadius: 9, border: '1px solid #e2e8f0', background: '#fff', fontSize: 13, color: '#475569', cursor: 'pointer' }}>
              {loading ? '⟳' : '↺'} Rafraîchir
            </button>

            <button onClick={() => setShowCreate(true)}
              style={{ height: 38, padding: '0 18px', borderRadius: 9, border: 'none', background: '#4f46e5', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: '0 1px 4px rgba(79,70,229,0.35)', whiteSpace: 'nowrap' }}>
              + Nouvelle affaire
            </button>
          </div>
        </div>
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
                    onDragStart={e => onDragStart(e, deal)} onDragEnd={onDragEnd} onSelect={() => setOpenDealId(deal.id)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {openDealId && <DealDrawer dealId={openDealId} onClose={() => setOpenDealId(null)} onUpdated={fetchDeals} />}
      {showCreate && <CreateDealModal columns={pipelineColumns} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); fetchDeals(); }} />}
      {pv && <PVModal onConfirm={handlePvConfirm} onCancel={handlePvCancel} />}
    </div>
  );
}
