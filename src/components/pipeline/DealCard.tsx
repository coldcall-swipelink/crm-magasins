'use client';
import type { Deal } from '@/types';

interface Props {
  deal: Deal;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onSelect: () => void;
}

// Couleurs de liseret par enseigne
function getBrandBorderColor(brandName?: string): string {
  if (!brandName) return '#6366f1';
  const n = brandName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (n.includes('leclerc')) return '#ffffff';
  if (n.includes('super u') || n.includes('super-u') || n === 'u') return '#2563eb';
  if (n.includes('intermarche') || n.includes('intermarché')) return '#e11d48';
  return brandName ? ('#' + Math.abs([...brandName].reduce((h, c) => Math.imul(31, h) + c.charCodeAt(0) | 0, 0)).toString(16).slice(0, 6).padEnd(6, '0')) : '#6366f1';
}

// Badge "Nouvelle" seulement si < 3 jours
function isRecentlyNew(createdAt: string): boolean {
  const created = new Date(createdAt);
  const now = new Date();
  const diffDays = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays < 3;
}

export default function DealCard({ deal, isDragging, onDragStart, onDragEnd, onSelect }: Props) {
  const store = deal.store;
  const brand = store?.brand;
  const borderColor = getBrandBorderColor(brand?.name);
  const offers = deal.jobOffers?.filter(o => o.status === 'active') ?? [];
  const movedBack = deal.hasNewOfferFromLastImport && !deal.isNewFromLastImport && deal.previousColumnId;
  const showNew = deal.isNewFromLastImport && isRecentlyNew(deal.createdAt);

  // Couleur de fond selon enseigne
  const bgAccent = brand?.name?.toLowerCase().includes('leclerc') ? '#1e40af11'
    : brand?.name?.toLowerCase().includes('super u') ? '#1d4ed811'
    : brand?.name?.toLowerCase().includes('intermarché') || brand?.name?.toLowerCase().includes('intermarche') ? '#e11d4811'
    : 'transparent';

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      style={{
        background: '#fff',
        border: `1px solid #e2e8f0`,
        borderRadius: 9,
        padding: '9px 11px',
        cursor: 'pointer',
        userSelect: 'none',
        borderLeft: `4px solid ${borderColor}`,
        outline: borderColor === '#ffffff' ? '1px solid #e2e8f0' : 'none',
        opacity: isDragging ? 0.5 : 1,
        boxShadow: movedBack ? '0 0 0 1.5px #f59e0b55' : '0 1px 3px rgba(0,0,0,.06)',
        transition: 'transform .1s, box-shadow .1s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 3px 10px rgba(0,0,0,.1)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; (e.currentTarget as HTMLDivElement).style.boxShadow = movedBack ? '0 0 0 1.5px #f59e0b55' : '0 1px 3px rgba(0,0,0,.06)'; }}
    >
      {/* En-tête */}
      {brand && <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: getBrandBorderColor(brand.name) === '#ffffff' ? '#2563eb' : getBrandBorderColor(brand.name), marginBottom: 2 }}>{brand.name}</div>}
      <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#0f172a' }}>{store?.name || 'Magasin'}</div>
      {store?.city && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>📍 {store.city}{store.department ? ` (${store.department})` : ''}</div>}

      {/* Contact calling */}
      {(deal as any).contactCalling && (
        <div style={{ fontSize: 10, color: '#4f46e5', marginTop: 3, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}>
          📞 {(deal as any).contactCalling}
        </div>
      )}

      {/* Badges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, margin: '5px 0' }}>
        {showNew && <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 10, fontWeight: 500, padding: '1px 5px', borderRadius: 3 }}>✦ Nouvelle</span>}
        {movedBack && <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: 500, padding: '1px 5px', borderRadius: 3 }}>⟳ Rappelée</span>}
        {!deal.isPresentInLastImport && <span style={{ background: '#fee2e2', color: '#b91c1c', fontSize: 10, fontWeight: 500, padding: '1px 5px', borderRadius: 3 }}>⚠ Absente</span>}
      </div>

      {/* Postes */}
      {offers.length > 0 && (
        <div style={{ fontSize: 10, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          💼 {offers.slice(0, 2).map(o => o.jobTitle || o.title).filter(Boolean).join(' · ')}{offers.length > 2 ? ` +${offers.length - 2}` : ''}
        </div>
      )}
    </div>
  );
}
