'use client';
// src/components/pipeline/DealCard.tsx
import type { Deal } from '@/types';
import { formatRelativeDate, isOverdue } from '@/lib/utils';
import { MapPin, Clock, AlertTriangle, GripVertical } from 'lucide-react';

interface Props {
  deal:        Deal;
  isDragging:  boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd:   () => void;
  onSelect:    () => void;
}

const PRIORITY_DOT: Record<string, string> = {
  urgente: 'bg-red-500',
  élevée:  'bg-amber-500',
  normale: 'bg-indigo-400',
  faible:  'bg-slate-300',
};

export default function DealCard({ deal, isDragging, onDragStart, onDragEnd, onSelect }: Props) {
  const store  = deal.store;
  const brand  = store?.brand;
  const bc     = brand?.color || '#6366f1';
  const offers = deal.jobOffers?.filter(o => o.status === 'active') ?? [];
  const nextAct = deal.actions?.[0] ?? null;
  const isLate  = nextAct && isOverdue(nextAct.dueDate);
  const isToday = nextAct && new Date(nextAct.dueDate).toDateString() === new Date().toDateString();

  // Badge retour automatique suite à nouvelle offre
  const wasMovedBack = deal.hasNewOfferFromLastImport && !deal.isNewFromLastImport && deal.previousColumnId;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      className={`deal-card border-l-[3px] group ${isDragging ? 'dragging' : ''}
        ${wasMovedBack ? 'ring-1 ring-amber-300' : ''}`}
      style={{ borderLeftColor: bc }}
    >
      {/* En-tête */}
      <div className="flex items-start gap-1.5 mb-2">
        <div className="flex-1 min-w-0">
          {brand && (
            <div className="text-[10px] font-bold tracking-wide mb-0.5 uppercase" style={{ color: bc }}>
              {brand.name}
            </div>
          )}
          <div className="text-xs font-semibold text-slate-800 truncate">{store?.name || 'Magasin'}</div>
          {store?.city && (
            <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
              <MapPin size={9} />
              {store.city}{store.department ? ` (${store.department})` : ''}
            </div>
          )}
        </div>
        <div className="text-slate-300 group-hover:text-slate-400 flex-shrink-0 mt-0.5">
          <GripVertical size={13} />
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1 mb-2">
        {deal.isNewFromLastImport && (
          <span className="badge bg-emerald-100 text-emerald-700">✦ Nouvelle</span>
        )}
        {wasMovedBack && (
          <span className="badge bg-amber-100 text-amber-700">⟳ Rappelée</span>
        )}
        {deal.hasNewOfferFromLastImport && !wasMovedBack && !deal.isNewFromLastImport && (
          <span className="badge bg-amber-50 text-amber-600">⟳ Offre màj</span>
        )}
        {!deal.isPresentInLastImport && (
          <span className="badge bg-red-100 text-red-600 flex items-center gap-1">
            <AlertTriangle size={9} /> Absente
          </span>
        )}
        <span className={`badge ${PRIORITY_DOT[deal.priority] ? '' : ''}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[deal.priority] || 'bg-slate-300'}`} />
          {deal.priority}
        </span>
      </div>

      {/* Postes */}
      {offers.length > 0 && (
        <div className="text-[10px] text-slate-500 mb-2 truncate">
          💼 {offers.slice(0, 2).map(o => o.jobTitle || o.title).filter(Boolean).join(' · ')}
          {offers.length > 2 && ` +${offers.length - 2}`}
        </div>
      )}

      {/* Prochaine action */}
      {nextAct ? (
        <div className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-md
          ${isLate ? 'bg-red-900/80 text-red-200' :
            isToday ? 'bg-amber-900/70 text-amber-200' : 'bg-slate-100 text-slate-500'}`}>
          <Clock size={9} />
          <span className="truncate">{nextAct.title}</span>
          <span className="ml-auto font-medium whitespace-nowrap">{formatRelativeDate(nextAct.dueDate)}</span>
        </div>
      ) : (
        <div className="text-[10px] text-amber-500 flex items-center gap-1">
          <AlertTriangle size={9} /> Aucune action prévue
        </div>
      )}
    </div>
  );
}
