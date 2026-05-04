'use client';
// src/components/deal/DealDrawer.tsx
import { useState, useEffect, useCallback } from 'react';
import type { Deal, Action, Note, Priority } from '@/types';
import { formatDate, isOverdue, formatRelativeDate } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import {
  X, MapPin, Building2, ExternalLink, Clock, AlertTriangle,
  Plus, Check, ChevronRight, Trash2, Edit2,
} from 'lucide-react';

const PRIORITIES: Priority[] = ['faible', 'normale', 'élevée', 'urgente'];
const ACTION_TYPES = ['Appeler', 'Email', 'Relancer', 'Démo', 'Autre'];

interface Props {
  dealId:    string;
  onClose:   () => void;
  onUpdated: () => void;
}

export default function DealDrawer({ dealId, onClose, onUpdated }: Props) {
  const [deal, setDeal]       = useState<Deal | null>(null);
  const [tab, setTab]         = useState<'info' | 'offers' | 'actions' | 'notes'>('info');
  const [noteText, setNote]   = useState('');
  const [actionForm, setAF]   = useState<Partial<Action> | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDeal = useCallback(async () => {
    const res = await fetch(`/api/deals/${dealId}`);
    if (res.ok) setDeal(await res.json());
    setLoading(false);
  }, [dealId]);

  useEffect(() => { fetchDeal(); }, [fetchDeal]);

  // ── Notes ─────────────────────────────────────────────────────────────────
  const addNote = async () => {
    if (!noteText.trim()) return;
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId, content: noteText }),
    });
    if (res.ok) { setNote(''); fetchDeal(); }
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const saveAction = async () => {
    if (!actionForm?.title || !actionForm.dueDate) return;
    const url  = actionForm.id ? `/api/actions/${actionForm.id}` : '/api/actions';
    const meth = actionForm.id ? 'PATCH' : 'POST';
    const body = { ...actionForm, dealId };
    const res = await fetch(url, {
      method: meth,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) { setAF(null); fetchDeal(); toast('Action enregistrée'); }
  };

  const doneAction = async (id: string) => {
    await fetch(`/api/actions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    fetchDeal();
  };

  const deleteAction = async (id: string) => {
    await fetch(`/api/actions/${id}`, { method: 'DELETE' });
    fetchDeal();
  };

  // ── Priorité ──────────────────────────────────────────────────────────────
  const setPriority = async (priority: Priority) => {
    await fetch(`/api/deals/${dealId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority }),
    });
    fetchDeal(); onUpdated();
  };

  if (loading || !deal) {
    return (
      <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
        <div className="w-[520px] bg-white h-full flex items-center justify-center">
          <div className="text-slate-400 text-sm">Chargement…</div>
        </div>
      </div>
    );
  }

  const store = deal.store;
  const brand = store?.brand;
  const bc    = brand?.color || '#6366f1';
  const prevCol = deal.previousColumnId ? deal.column : null; // colonne précédente mémorisée
  const wasMovedBack = deal.hasNewOfferFromLastImport && !deal.isNewFromLastImport && deal.previousColumnId;
  const TABS = [
    { id: 'info',    label: 'Infos' },
    { id: 'offers',  label: `Offres (${deal.jobOffers?.length ?? 0})` },
    { id: 'actions', label: `Actions (${deal.actions?.filter(a => a.status === 'todo').length ?? 0})` },
    { id: 'notes',   label: `Notes (${deal.notes?.length ?? 0})` },
  ] as const;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div
        className="w-[520px] bg-white h-full flex flex-col shadow-2xl border-l border-slate-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-shrink-0 border-t-4 px-5 py-4 border-b border-slate-200" style={{ borderTopColor: bc }}>
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {brand && <div className="text-xs font-bold uppercase tracking-wider mb-0.5" style={{ color: bc }}>{brand.name}</div>}
              <h2 className="text-base font-semibold text-slate-900">{store?.name}</h2>
              {store?.city && (
                <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                  <MapPin size={11} /> {store.city}{store.department ? `, ${store.department}` : ''}
                </div>
              )}
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={16} /></button>
          </div>

          {/* Alerte retour automatique */}
          {wasMovedBack && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs">
              <div className="font-semibold text-amber-700 mb-0.5">⟳ Retournée en « À appeler » — nouvelle offre</div>
              <div className="text-amber-600">Une nouvelle offre a été détectée lors du dernier import.</div>
            </div>
          )}

          {/* Contrôles rapides */}
          <div className="flex gap-2 mt-3 flex-wrap">
            {deal.isNewFromLastImport && <span className="badge bg-emerald-100 text-emerald-700">✦ Nouvelle affaire</span>}
            {!deal.isPresentInLastImport && <span className="badge bg-red-100 text-red-600">⚠ Absente du dernier import</span>}

            {/* Priorité */}
            <select
              value={deal.priority}
              onChange={e => setPriority(e.target.value as Priority)}
              className="form-input text-xs h-7 w-auto px-2"
            >
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>

            <div className="text-xs px-2 py-1 rounded-lg font-medium" style={{ background: `${bc}22`, color: bc }}>
              {deal.column?.title}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 flex-shrink-0">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-2.5 text-xs font-medium border-b-2 transition-colors
                ${tab === t.id ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Contenu tabs */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ── INFO ── */}
          {tab === 'info' && (
            <div className="space-y-5">
              <Section title="Magasin">
                <Row label="Enseigne"   value={brand?.name}          />
                <Row label="Nom"        value={store?.name}          />
                <Row label="Ville"      value={store?.city}          />
                <Row label="Dépt"       value={store?.department}    />
                <Row label="Adresse"    value={store?.address}       />
                <Row label="SIRET"      value={store?.siret}         />
              </Section>
              <Section title="CRM">
                <Row label="Créé le"       value={formatDate(deal.createdAt)}    />
                <Row label="Dernier import" value={formatDate(deal.lastImportAt!)} />
                <Row label="Colonne"       value={deal.column?.title}            />
                <Row label="Priorité"      value={deal.priority}                 />
              </Section>
            </div>
          )}

          {/* ── OFFRES ── */}
          {tab === 'offers' && (
            <div className="space-y-3">
              {!deal.jobOffers?.length && <p className="text-sm text-slate-400">Aucune offre.</p>}
              {deal.jobOffers?.map(o => (
                <div key={o.id} className="border border-slate-200 rounded-xl p-3 bg-slate-50">
                  <div className="flex items-start gap-2 mb-2">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-slate-800">{o.title || o.jobTitle || '—'}</div>
                      {o.jobTitle && o.jobTitle !== o.title && <div className="text-xs text-slate-500">{o.jobTitle}</div>}
                    </div>
                    <span className={`badge text-[10px] ${o.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                      {o.status === 'active' ? 'active' : 'disparue'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
                    {o.contractType && <span>📄 {o.contractType}</span>}
                    {o.salary       && <span>💰 {o.salary}</span>}
                    {o.source       && <span>🔗 {o.source}</span>}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1.5">
                    Vue du {formatDate(o.firstSeenAt)} au {formatDate(o.lastSeenAt)}
                  </div>
                  {o.url && (
                    <a href={o.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline mt-1.5">
                      <ExternalLink size={10} /> Voir l'offre
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── ACTIONS ── */}
          {tab === 'actions' && (
            <div>
              <button
                className="btn-primary mb-4 flex items-center gap-2 text-xs"
                onClick={() => setAF({ title: '', type: 'Appeler', dueDate: new Date().toISOString().slice(0, 10), priority: 'normale', note: '' })}
              >
                <Plus size={13} /> Nouvelle action
              </button>

              {actionForm && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <input className="form-input col-span-2" placeholder="Titre de l'action *" value={actionForm.title || ''} onChange={e => setAF(f => ({ ...f, title: e.target.value }))} />
                    <select className="form-input" value={actionForm.type || 'Appeler'} onChange={e => setAF(f => ({ ...f, type: e.target.value as Action['type'] }))}>
                      {ACTION_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                    <select className="form-input" value={actionForm.priority || 'normale'} onChange={e => setAF(f => ({ ...f, priority: e.target.value as Priority }))}>
                      {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                    </select>
                    <input type="date" className="form-input" value={typeof actionForm.dueDate === 'string' ? actionForm.dueDate.slice(0, 10) : ''} onChange={e => setAF(f => ({ ...f, dueDate: e.target.value }))} />
                    <input type="time" className="form-input" value={actionForm.dueTime || ''} onChange={e => setAF(f => ({ ...f, dueTime: e.target.value }))} placeholder="Heure (optionnel)" />
                    <textarea className="form-input col-span-2 h-16 resize-none" placeholder="Note…" value={actionForm.note || ''} onChange={e => setAF(f => ({ ...f, note: e.target.value }))} />
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-primary text-xs px-3 py-1.5" onClick={saveAction}>Enregistrer</button>
                    <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => setAF(null)}>Annuler</button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {!deal.actions?.length && !actionForm && <p className="text-sm text-slate-400">Aucune action.</p>}
                {deal.actions?.map(a => {
                  const late  = a.status === 'todo' && isOverdue(a.dueDate);
                  const today = new Date(a.dueDate).toDateString() === new Date().toDateString();
                  return (
                    <div key={a.id} className={`flex items-start gap-3 p-3 rounded-xl border transition-colors
                      ${a.status === 'done' ? 'bg-slate-50 border-slate-200 opacity-60' :
                        late && !today     ? 'bg-red-50 border-red-200' :
                        today              ? 'bg-amber-50 border-amber-200' :
                                             'bg-white border-slate-200'}`}>
                      {/* Checkbox */}
                      <button
                        onClick={() => a.status === 'todo' && doneAction(a.id)}
                        className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center mt-0.5 transition-colors
                          ${a.status === 'done' ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 hover:border-indigo-500'}`}
                      >
                        {a.status === 'done' && <Check size={10} className="text-white" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium ${a.status === 'done' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                          {a.title}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="badge bg-indigo-50 text-indigo-600 text-[10px]">{a.type}</span>
                          <span className={`text-[10px] font-medium ${late && !today ? 'text-red-600' : 'text-slate-500'}`}>
                            <Clock size={9} className="inline mr-0.5" />
                            {formatRelativeDate(a.dueDate)}
                          </span>
                          {a.note && <span className="text-[10px] text-slate-400 truncate max-w-40">{a.note}</span>}
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => setAF({ ...a, dueDate: typeof a.dueDate === 'string' ? a.dueDate.slice(0,10) : '' })} className="p-1 text-slate-400 hover:text-indigo-600"><Edit2 size={12} /></button>
                        <button onClick={() => deleteAction(a.id)} className="p-1 text-slate-400 hover:text-red-500"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── NOTES ── */}
          {tab === 'notes' && (
            <div>
              <div className="mb-4">
                <textarea
                  className="form-input h-24 resize-none mb-2 w-full"
                  placeholder="Ajouter une note commerciale…"
                  value={noteText}
                  onChange={e => setNote(e.target.value)}
                />
                <button className="btn-primary text-xs" onClick={addNote}>Ajouter la note</button>
              </div>
              <div className="space-y-3">
                {!deal.notes?.length && <p className="text-sm text-slate-400">Aucune note.</p>}
                {deal.notes?.map((n: Note) => (
                  <div key={n.id} className="border border-slate-200 rounded-xl p-3 bg-white">
                    <p className="text-sm text-slate-800 whitespace-pre-wrap mb-2">{n.content}</p>
                    <p className="text-[10px] text-slate-400">{formatDate(n.createdAt)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-28 flex-shrink-0 text-slate-400">{label}</span>
      <span className="text-slate-700">{value || '—'}</span>
    </div>
  );
}
