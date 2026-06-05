'use client';
import type { Deal } from '@/types';

interface Props {
  deal: Deal;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onSelect: () => void;
}

function getBrandBorderColor(brandName?: string): string {
  if (!brandName) return '#6366f1';
  const n = brandName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (n.includes('leclerc')) return '#ffffff';
  if (n.includes('super u') || n.includes('super-u') || n === 'u') return '#2563eb';
  if (n.includes('intermarche') || n.includes('intermarché')) return '#e11d48';
  let h = 0;
  for (let i = 0; i < brandName.length; i++) h = Math.imul(31, h) + brandName.charCodeAt(i) | 0;
  return '#' + Math.abs(h).toString(16).slice(0, 6).padEnd(6, '0');
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function getActionBackgroundColor(actions?: any[]): string {
  if (!actions || actions.length === 0) return '#ffffff';
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  for (const action of actions) {
    if (action.status === 'done') continue; // Ignorer les actions complétées
    
    const dueDate = new Date(action.dueDate);
    dueDate.setHours(0, 0, 0, 0);
    
    if (dueDate < today) return '#fce7e6'; // Rouge pastel (retard)
    if (dueDate.getTime() === today.getTime()) return '#e0f2fe'; // Bleu ciel léger (aujourd'hui)
    if (dueDate > today) return '#f3f4f6'; // Gris très léger (à venir)
  }
  
  return '#ffffff'; // Blanc par défaut
}

export default function DealCard({ deal, isDragging, onDragStart, onDragEnd, onSelect }: Props) {
  const store = deal.store;
  const brand = store?.brand;
  const borderColor = getBrandBorderColor(brand?.name);
  const offers = deal.jobOffers?.filter(o => o.status === 'active') ?? [];
  const movedBack = deal.hasNewOfferFromLastImport && !deal.isNewFromLastImport && deal.previousColumnId;
  const displayColor = borderColor === '#ffffff' ? '#2563eb' : borderColor;
  const collaborator = (deal as any).collaborator;
  const assignedUser = (deal as any).assignedUser;
  const backgroundColor = getActionBackgroundColor(deal.actions);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      style={{
        background: backgroundColor,
        border: '1px solid #e2e8f0',
        borderRadius: 9,
        padding: '9px 11px',
        cursor: 'pointer',
        userSelect: 'none',
        borderLeft: `4px solid ${borderColor}`,
        outline: borderColor === '#ffffff' ? '1px solid #cbd5e1' : 'none',
        opacity: isDragging ? 0.5 : 1,
        boxShadow: movedBack ? '0 0 0 1.5px #f59e0b55' : '0 1px 3px rgba(0,0,0,.06)',
        transition: 'transform .1s, box-shadow .1s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 3px 10px rgba(0,0,0,.1)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.transform = '';
        (e.currentTarget as HTMLDivElement).style.boxShadow = movedBack ? '0 0 0 1.5px #f59e0b55' : '0 1px 3px rgba(0,0,0,.06)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 4, marginBottom: 2 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {brand && <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: displayColor, marginBottom: 1 }}>{brand.name}</div>}
          <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#0f172a' }}>{store?.name || 'Magasin'}</div>
          {store?.city && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>📍 {store.city}{store.department ? ` (${store.department})` : ''}</div>}
        </div>
        {(collaborator || assignedUser) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            {assignedUser && (
              <div title={`Suivi par ${assignedUser.name}`} style={{ width: 22, height: 22, borderRadius: '50%', background: assignedUser.color, color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid #fff', boxShadow: '0 0 0 1px ' + assignedUser.color }}>
                {initials(assignedUser.name)}
              </div>
            )}
            {collaborator && (
              <div title={collaborator.name} style={{ width: 22, height: 22, borderRadius: '50%', background: collaborator.color, color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {initials(collaborator.name)}
              </div>
            )}
          </div>
        )}
      </div>

      {(deal as any).contactCalling && (
        <div style={{ fontSize: 10, color: '#4f46e5', marginTop: 2, fontWeight: 500 }}>📞 {(deal as any).contactCalling}</div>
      )}

      {movedBack && (
        <div style={{ margin: '5px 0' }}>
          <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: 500, padding: '1px 5px', borderRadius: 3 }}>⟳ Rappelée</span>
        </div>
      )}

      {offers.length > 0 && (
        <div style={{ fontSize: 10, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          💼 {offers.slice(0, 2).map(o => o.jobTitle || o.title).filter(Boolean).join(' · ')}{offers.length > 2 ? ` +${offers.length - 2}` : ''}
        </div>
      )}
    </div>
  );
}
