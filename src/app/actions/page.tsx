'use client';
// src/app/actions/page.tsx
import { useEffect, useState, useCallback } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import type { Action, Deal, Priority } from '@/types';
import { formatRelativeDate, isOverdue } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { Plus, Check, Trash2, Edit2, Clock, CalendarCheck } from 'lucide-react';

const PRIORITIES: Priority[] = ['faible', 'normale', 'élevée', 'urgente'];
const ACTION_TYPES = ['Appeler', 'Email', 'Relancer', 'Démo', 'Autre'];
type Tab = 'todo' | 'today' | 'overdue' | 'done';

export default function ActionsPage() {
  const [actions, setActions] = useState<Action[]>([]);
  const [deals,   setDeals]   = useState<Deal[]>([]);
  const [tab,     setTab]     = useState<Tab>('todo');
  const [form,    setForm]    = useState<Partial<Action> | null>(null);

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay   = new Date(startOfDay.getTime() + 86400000);

  const fetchAll = useCallback(async () => {
    const [aRes, dRes] = await Promise.all([
      fetch('/api/actions'),
      fetch('/api/deals'),
    ]);
    if (aRes.ok) setActions(await aRes.json());
    if (dRes.ok) setDeals(await dRes.json());
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = actions.filter(a => {
    const d = new Date(a.dueDate);
    if (tab === 'todo')    return a.status === 'todo';
    if (tab === 'today')   return a.status === 'todo' && d >= startOfDay && d < endOfDay;
    if (tab === 'overdue') return a.status === 'todo' && d < startOfDay;
    if (tab === 'done')    return a.status === 'done';
    return true;
  }).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const saveAction = async () => {
    if (!form?.title || !form.dueDate || !form.dealId) {
      toast('Titre, date et affaire requis', 'error'); return;
    }
    const url  = form.id ? `/api/actions/${form.id}` : '/api/actions';
    const meth = form.id ? 'PATCH' : 'POST';
    const res  = await fetch(url, {
      method: meth,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (res.ok) { setForm(null); fetchAll(); toast('Action enregistrée'); }
    else toast('Erreur', 'error');
  };

  const doneAction = async (id: string) => {
    await fetch(`/api/actions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) });
    fetchAll(); toast('Action marquée comme faite');
  };

  const deleteAction = async (id: string) => {
    await fetch(`/api/actions/${id}`, { method: 'DELETE' });
    fetchAll();
  };

  const getDealLabel = (dealId: string) => {
    const d = deals.find(x => x.id === dealId);
    return d?.store?.name || 'Affaire';
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: 'todo',    label: 'À faire'       },
    { id: 'today',   label: "Aujourd'hui"   },
    { id: 'overdue', label: 'En retard'     },
    { id: 'done',    label: 'Terminées'     },
  ];

  const overdueCount = actions.filter(a => a.status === 'todo' && new Date(a.dueDate) < startOfDay).length;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-center gap-3 mb-6">
          <CalendarCheck size={20} className="text-slate-400" />
          <h1 className="text-xl font-bold text-slate-900 flex-1">Actions & Rappels</h1>
          <button
            className="btn-primary flex items-center gap-2 text-sm"
            onClick={() => setForm({ title: '', type: 'Appeler', dueDate: now.toISOString().slice(0, 10), priority: 'normale', note: '', dealId: '' })}
          >
            <Plus size={14} /> Nouvelle action
          </button>
        </div>

        {/* Onglets */}
        <div className="flex gap-2 mb-5">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors
                ${tab === t.id
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-400'}`}
            >
              {t.label}
              {t.id === 'overdue' && overdueCount > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-[10px] rounded px-1">{overdueCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* Formulaire */}
        {form && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-5">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <input className="form-input col-span-2" placeholder="Titre *" value={form.title || ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              <select className="form-input" value={form.type || 'Appeler'} onChange={e => setForm(f => ({ ...f, type: e.target.value as Action['type'] }))}>
                {ACTION_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
              <select className="form-input" value={form.priority || 'normale'} onChange={e => setForm(f => ({ ...f, priority: e.target.value as Priority }))}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
              <input type="date" className="form-input" value={typeof form.dueDate === 'string' ? form.dueDate.slice(0, 10) : ''} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
              <select className="form-input" value={form.dealId || ''} onChange={e => setForm(f => ({ ...f, dealId: e.target.value }))}>
                <option value="">— Affaire liée *—</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.store?.name || d.id}</option>)}
              </select>
              <textarea className="form-input col-span-2 h-16 resize-none" placeholder="Note…" value={form.note || ''} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <button className="btn-primary text-xs" onClick={saveAction}>Enregistrer</button>
              <button className="btn-secondary text-xs" onClick={() => setForm(null)}>Annuler</button>
            </div>
          </div>
        )}

        {/* Liste */}
        {filtered.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <Check size={36} className="mx-auto mb-3 opacity-30" />
            <p>Aucune action dans cet onglet.</p>
          </div>
        )}

        <div className="space-y-2">
          {filtered.map(a => {
            const d      = new Date(a.dueDate);
            const late   = a.status === 'todo' && d < startOfDay;
            const today  = d >= startOfDay && d < endOfDay;
            return (
              <div
                key={a.id}
                className={`flex items-center gap-3 p-4 bg-white border rounded-xl
                  ${late && a.status === 'todo'  ? 'border-red-200 bg-red-50' :
                    today && a.status === 'todo' ? 'border-amber-200 bg-amber-50' :
                                                   'border-slate-200'}`}
              >
                {/* Checkbox */}
                <button
                  onClick={() => a.status === 'todo' && doneAction(a.id)}
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors
                    ${a.status === 'done' ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 hover:border-indigo-500'}`}
                >
                  {a.status === 'done' && <Check size={10} className="text-white" />}
                </button>

                {/* Contenu */}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${a.status === 'done' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                    {a.title}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="badge bg-indigo-50 text-indigo-600 text-[10px]">{a.type}</span>
                    <span className="text-[11px] text-slate-500">{getDealLabel(a.dealId)}</span>
                    {a.note && <span className="text-[10px] text-slate-400 truncate max-w-48">{a.note}</span>}
                  </div>
                </div>

                {/* Date */}
                <div className={`text-xs font-medium whitespace-nowrap flex items-center gap-1
                  ${late && a.status === 'todo' ? 'text-red-600' : 'text-slate-500'}`}>
                  <Clock size={11} />{formatRelativeDate(a.dueDate)}
                </div>

                {/* Actions */}
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => setForm({ ...a, dueDate: typeof a.dueDate === 'string' ? a.dueDate.slice(0,10) : new Date(a.dueDate).toISOString().slice(0,10) })} className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50"><Edit2 size={13} /></button>
                  <button onClick={() => deleteAction(a.id)} className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50"><Trash2 size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
