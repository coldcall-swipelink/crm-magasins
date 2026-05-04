'use client';
import type { Deal } from '@/types';
import { formatRelativeDate, isOverdue } from '@/lib/utils';

interface Props {
  deal: Deal;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onSelect: () => void;
}

export default function DealCard({ deal, isDragging, onDragStart, onDragEnd, onSelect }: Props) {
  const store = deal.store;
  const brand = store?.brand;
  const bc = brand?.color || '#6366f1';
  const offers = deal.jobOffers?.filter(o => o.status === 'active') ?? [];
  const nextAct = deal.actions?.[0] ?? null;
  const late = nextAct && isOverdue(nextAct.dueDate) && new Date(nextAct.dueDate).toDateString() !== new Date().toDateString();
  const today = nextAct && new Date(nextAct.dueDate).toDateString() === new Date().toDateString();
  const movedBack = deal.hasNewOfferFromLastImport && !deal.isNewFromLastImport && deal.previousColumnId;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9,
        padding: '9px 11px', cursor: 'pointer', userSelect: 'none',
        borderLeft: `3px solid ${bc}`, opacity: isDragging ? 0.5 : 1,
        boxShadow: movedBack ? '0 0 0 1.5px #f59e0b55' : undefined,
        transition: 'transform .1s, box-shadow .1s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 3px 10px rgba(0,0,0,.1)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; (e.currentTarget as HTMLDivElement).style.boxShadow = movedBack ? '0 0 0 1.5px #f59e0b55' : ''; }}
    >
      {brand && <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: bc, marginBottom: 2 }}>{brand.name}</div>}
      <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#0f172a' }}>{store?.name || 'Magasin'}</div>
      {store?.city && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>📍 {store.city}{store.department ? ` (${store.department})` : ''}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, margin: '5px 0' }}>
        {deal.isNewFromLastImport && <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 10, fontWeight: 500, padding: '1px 5px', borderRadius: 3 }}>✦ Nouvelle</span>}
        {movedBack && <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: 500, padding: '1px 5px', borderRadius: 3 }}>⟳ Rappelée</span>}
        {!deal.isPresentInLastImport && <span style={{ background: '#fee2e2', color: '#b91c1c', fontSize: 10, fontWeight: 500, padding: '1px 5px', borderRadius: 3 }}>⚠ Absente</span>}
      </div>

      {offers.length > 0 && (
        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          💼 {offers.slice(0, 2).map(o => o.jobTitle || o.title).filter(Boolean).join(' · ')}{offers.length > 2 ? ` +${offers.length - 2}` : ''}
        </div>
      )}

      {nextAct ? (
        <div style={{
          fontSize: 10, padding: '3px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3,
          background: late ? '#7f1d1d' : today ? '#451a03' : '#f1f5f9',
          color: late ? '#fca5a5' : today ? '#fde68a' : '#64748b',
        }}>
          🕐 <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nextAct.title}</span>
          <span style={{ flexShrink: 0 }}>{formatRelativeDate(nextAct.dueDate)}</span>
        </div>
      ) : (
        <div style={{ fontSize: 10, color: '#f59e0b' }}>⚠ Aucune action</div>
      )}
    </div>
  );
}
