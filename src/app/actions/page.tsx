'use client';
import { useEffect, useState, useCallback } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import type { Action, Deal, Priority } from '@/types';
import { formatRelativeDate, isOverdue } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import DealDrawer from '@/components/deal/DealDrawer';

const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: 13, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnDef: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const PRIORITIES: Priority[] = ['faible', 'normale', 'élevée', 'urgente'];
const ACTION_TYPES = ['Appeler', 'Email', 'Relancer', 'Démo', 'Autre'];
type Tab = 'todo' | 'today' | 'overdue' | 'done';

interface Collaborator { id: string; name: string; color: string; }

function initials(name: string) { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }

export default function ActionsPage() {
  const [actions, setActions] = useState<Action[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [tab, setTab] = useState<Tab>('todo');
  const [form, setForm] = useState<Partial<Action> | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [filterCollab, setFilterCollab] = useState('');
  const now = new Date();
  const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const fetchAll = useCallback(async () => {
    const [aRes, dRes, cRes] = await Promise.all([
      fetch('/api/actions'),
      fetch('/api/deals'),
      fetch('/api/collaborators'),
    ]);
    if (aRes.ok) setActions(await aRes.json());
    if (dRes.ok) setDeals(await dRes.json());
    if (cRes.ok) setCollaborators(await cRes.json());
  }, []);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const getDeal = (dealId: string) => deals.find(x => x.id === dealId);

  const filtered = actions.filter(a => {
    const d = new Date(a.dueDate);
    const matchTab = tab === 'todo' ? a.status === 'todo'
      : tab === 'today' ? a.status === 'todo' && d.toDateString() === now.toDateString()
      : tab === 'overdue' ? a.status === 'todo' && d < startDay
      : a.status === 'done';
    if (!matchTab) return false;
    if (filterCollab) {
      const deal = getDeal(a.dealId);
      if ((deal as any)?.collaboratorId !== filterCollab) return false;
    }
    return true;
  }).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const overdue = actions.filter(a => a.status === 'todo' && new Date(a.dueDate) < startDay).length;

  const saveAction = async () => {
    if (!form?.title || !form.dueDate || !form.dealId) { toast('Titre, date et affaire requis', 'error'); return; }
    const url = form.id ? `/api/actions/${form.id}` : '/api/actions';
    const res = await fetch(url, { method: form.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    if (res.ok) { setForm(null); fetchAll(); toast('Action enregistrée'); }
  };

  const doneAction = async (id: string) => {
    await fetch(`/api/actions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) });
    fetchAll(); toast('✓ Terminée');
  };

  const deleteAction = async (id: string) => { await fetch(`/api/actions/${id}`, { method: 'DELETE' }); fetchAll(); };

  const tabBtn = (id: Tab, label: string) => (
    <button key={id} onClick={() => setTab(id)} style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: '1px solid', background: tab === id ? '#4f46e5' : '#fff', color: tab === id ? '#fff' : '#475569', borderColor: tab === id ? '#4f46e5' : '#e2e8f0', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {label}
      {id === 'overdue' && overdue > 0 && <span style={{ background: '#dc2626', color: '#fff', borderRadius: 3, padding: '0 4px', fontSize: 10 }}>{overdue}</span>}
    </button>
  );

  return (
    <AppLayout>
      <div style={{ padding: '24px', maxWidth: 860 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>Actions & Rappels</span>
          <button style={btnPri} onClick={() => setForm({ title: '', type: 'Appeler', dueDate: now.toISOString().slice(0, 10), priority: 'normale', dealId: '', note: '' })}>+ Nouvelle action</button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {tabBtn('todo', 'À faire')}
          {tabBtn('today', 'Auj.')}
          {tabBtn('overdue', 'En retard')}
          {tabBtn('done', 'Terminées')}
          <div style={{ marginLeft: 'auto' }}>
            <select value={filterCollab} onChange={e => setFilterCollab(e.target.value)}
              style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: filterCollab ? '#eef2ff' : '#fff', fontSize: 12, color: filterCollab ? '#4338ca' : '#475569', cursor: 'pointer', outline: 'none' }}>
              <option value="">Tous collaborateurs</option>
              {collaborators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {form && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <input style={{ ...inp, gridColumn: '1/-1' }} placeholder="Titre *" value={form.title || ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              <select style={inp} value={form.type || 'Appeler'} onChange={e => setForm(f => ({ ...f, type: e.target.value as Action['type'] }))}>{ACTION_TYPES.map(t => <option key={t}>{t}</option>)}</select>
              <select style={inp} value={form.priority || 'normale'} onChange={e => setForm(f => ({ ...f, priority: e.target.value as Priority }))}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select>
              <input type="date" style={inp} value={typeof form.dueDate === 'string' ? form.dueDate.slice(0, 10) : ''} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
              <select style={inp} value={form.dealId || ''} onChange={e => setForm(f => ({ ...f, dealId: e.target.value }))}>
                <option value="">— Affaire liée * —</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.store?.name || d.id}</option>)}
              </select>
              <textarea style={{ ...inp, height: 46, resize: 'none', gridColumn: '1/-1' }} placeholder="Note…" value={form.note || ''} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btnPri} onClick={saveAction}>Enregistrer</button>
              <button style={btnDef} onClick={() => setForm(null)}>Annuler</button>
            </div>
          </div>
        )}

        {!filtered.length && <div style={{ color: '#94a3b8', fontSize: 13, padding: '30px 0', textAlign: 'center' }}>Aucune action dans cet onglet.</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(a => {
            const late = a.status === 'todo' && new Date(a.dueDate) < startDay && new Date(a.dueDate).toDateString() !== now.toDateString();
            const deal = getDeal(a.dealId);
            const collab = collaborators.find(c => c.id === (deal as any)?.collaboratorId);

            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#fff', border: `1px solid ${late ? '#fecaca' : '#e2e8f0'}`, borderRadius: 10, borderLeft: `3px solid ${late ? '#dc2626' : '#e2e8f0'}` }}>
                <button onClick={() => a.status === 'todo' && doneAction(a.id)} style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${a.status === 'done' ? '#16a34a' : '#cbd5e1'}`, background: a.status === 'done' ? '#16a34a' : 'transparent', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10 }}>
                  {a.status === 'done' && '✓'}
                </button>

                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setSelectedDealId(a.dealId)}>
                  <div style={{ fontSize: 13, fontWeight: 500, textDecoration: a.status === 'done' ? 'line-through' : 'none', color: a.status === 'done' ? '#94a3b8' : '#0f172a' }}>{a.title}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 2, fontSize: 11, color: '#64748b', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ background: '#eef2ff', color: '#4338ca', padding: '1px 5px', borderRadius: 3 }}>{a.type}</span>
                    <span style={{ color: '#4f46e5', fontWeight: 500, textDecoration: 'underline' }}>
                      {deal?.store?.name || 'Affaire'}
                    </span>
                    {collab && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ width: 16, height: 16, borderRadius: '50%', background: collab.color, color: '#fff', fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{initials(collab.name)}</span>
                        <span style={{ color: '#64748b' }}>{collab.name}</span>
                      </span>
                    )}
                    {a.note && <span style={{ color: '#94a3b8' }}>{a.note.slice(0, 50)}</span>}
                  </div>
                </div>

                <div style={{ fontSize: 12, color: late ? '#dc2626' : '#64748b', fontWeight: late ? 600 : 400, whiteSpace: 'nowrap' }}>🕐 {formatRelativeDate(a.dueDate)}</div>
                <button onClick={() => setForm({ ...a, dueDate: typeof a.dueDate === 'string' ? a.dueDate.slice(0, 10) : new Date(a.dueDate).toISOString().slice(0, 10) })} style={{ ...btnDef, padding: '3px 8px', fontSize: 11 }}>✎</button>
                <button onClick={() => deleteAction(a.id)} style={{ ...btnDef, padding: '3px 8px', fontSize: 11 }}>🗑</button>
              </div>
            );
          })}
        </div>
      </div>

      {selectedDealId && (
        <DealDrawer dealId={selectedDealId} onClose={() => setSelectedDealId(null)} onUpdated={fetchAll} />
      )}
    </AppLayout>
  );
}
