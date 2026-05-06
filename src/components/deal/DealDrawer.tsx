'use client';
import { useState, useEffect, useCallback } from 'react';
import type { Action, Note, Priority } from '@/types';
import { formatDate, isOverdue, formatRelativeDate } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';

const PRIORITIES: Priority[] = ['faible', 'normale', 'élevée', 'urgente'];
const ACTION_TYPES = ['Appeler', 'Email', 'Relancer', 'Démo', 'Autre'];
const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: 13, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '6px 12px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 12 };
const btnDef: React.CSSProperties = { padding: '6px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 12 };

interface Collaborator { id: string; name: string; color: string; email: string; }
interface Props { dealId: string; onClose: () => void; onUpdated: () => void; }

function initials(name: string) { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }

export default function DealDrawer({ dealId, onClose, onUpdated }: Props) {
  const [deal, setDeal] = useState<any | null>(null);
  const [tab, setTab] = useState<'info' | 'offers' | 'actions' | 'notes'>('info');
  const [noteText, setNote] = useState('');
  const [actionForm, setAF] = useState<Partial<Action> | null>(null);
  const [loading, setLoading] = useState(true);
  const [editContacts, setEditContacts] = useState(false);
  const [contacts, setContacts] = useState({ directeur: '', contactCalling: '', dealEmail: '' });
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [columns, setColumns] = useState<any[]>([]);

  const fetchDeal = useCallback(async () => {
    const res = await fetch(`/api/deals/${dealId}`);
    if (res.ok) {
      const d = await res.json();
      setDeal(d);
      setContacts({ directeur: d.directeur || '', contactCalling: d.contactCalling || '', dealEmail: d.dealEmail || '' });
    }
    setLoading(false);
  }, [dealId]);

  useEffect(() => { fetchDeal(); }, [fetchDeal]);
  useEffect(() => { fetch('/api/collaborators').then(r => r.json()).then(setCollaborators).catch(() => {}); }, []);
  useEffect(() => { fetch('/api/columns').then(r => r.json()).then(setColumns).catch(() => {}); }, []);

  const saveContacts = async () => {
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contacts) });
    setEditContacts(false); fetchDeal(); onUpdated(); toast('Contacts mis à jour');
  };

  const assignCollaborator = async (collaboratorId: string | null) => {
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collaboratorId }) });
    fetchDeal(); onUpdated(); toast('Assignation mise à jour');
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dealId, content: noteText }) });
    setNote(''); fetchDeal(); onUpdated();
  };

  const saveAction = async () => {
    if (!actionForm?.title || !actionForm.dueDate) return;
    const url = actionForm.id ? `/api/actions/${actionForm.id}` : '/api/actions';
    await fetch(url, { method: actionForm.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...actionForm, dealId }) });
    setAF(null); fetchDeal(); onUpdated(); toast('Action enregistrée');
  };

  const doneAction = async (id: string) => {
    await fetch(`/api/actions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) });
    fetchDeal(); onUpdated();
  };

  const deleteAction = async (id: string) => {
    await fetch(`/api/actions/${id}`, { method: 'DELETE' });
    fetchDeal(); onUpdated();
  };

  const setPriority = async (priority: Priority) => {
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority }) });
    fetchDeal(); onUpdated();
  };

  if (loading || !deal) return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,.3)', display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: 500, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#94a3b8' }}>Chargement…</span>
      </div>
    </div>
  );

  const store = deal.store;
  const brand = store?.brand;
  const bc = brand?.color || '#6366f1';
  const isWhite = bc === '#ffffff';
  const col = deal.column;
  const movedBack = deal.hasNewOfferFromLastImport && !deal.isNewFromLastImport && deal.previousColumnId;
  const dOffers = deal.jobOffers?.sort((a: any, b: any) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime()) ?? [];
  const dActions = deal.actions?.sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()) ?? [];
  const dNotes = deal.notes?.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) ?? [];
  const todoCount = dActions.filter((a: any) => a.status === 'todo').length;
  const currentCollab = deal.collaborator as Collaborator | null;

  const TABS = [['info','Infos'],['offers',`Offres (${dOffers.length})`],['actions',`Actions (${todoCount})`],['notes',`Notes (${dNotes.length})`]] as const;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,.3)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 500, height: '100%', background: '#fff', borderLeft: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, borderTop: `4px solid ${bc}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {brand && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: isWhite ? '#2563eb' : bc, marginBottom: 2 }}>{brand.name}</div>}
              <div style={{ fontSize: 15, fontWeight: 700 }}>{store?.name}</div>
              {store?.city && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>📍 {store.city}{store.department ? `, ${store.department}` : ''}</div>}
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#94a3b8', padding: 0 }}>×</button>
          </div>

          {movedBack && (
            <div style={{ marginTop: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7, padding: '8px 10px', fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 2 }}>⟳ Retournée en "À appeler"</div>
              <div style={{ color: '#78350f' }}>Nouvelle offre détectée lors du dernier import.</div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {deal.isNewFromLastImport && <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 11, padding: '2px 7px', borderRadius: 4, fontWeight: 500 }}>✦ Nouvelle</span>}
            {!deal.isPresentInLastImport && <span style={{ background: '#fee2e2', color: '#b91c1c', fontSize: 11, padding: '2px 7px', borderRadius: 4, fontWeight: 500 }}>⚠ Absente</span>}
            <select value={deal.priority} onChange={e => setPriority(e.target.value as Priority)} style={{ ...inp, width: 'auto', padding: '3px 8px', fontSize: 11 }}>
              {PRIORITIES.map(p => <option key={p}>{p}</option>)}
            </select>
            {columns.length > 0 && (
              <select
                value={deal.columnId}
                onChange={async e => {
                  await fetch(`/api/deals/${dealId}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columnId: e.target.value }) });
                  fetchDeal(); onUpdated(); toast('Étape mise à jour');
                }}
                style={{
                  padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                  background: isWhite ? '#f1f5f9' : `${bc}22`,
                  color: isWhite ? '#475569' : bc,
                  border: `1px solid ${isWhite ? '#e2e8f0' : bc + '44'}`,
                  cursor: 'pointer', outline: 'none',
                }}
              >
                {[...columns].sort((a, b) => a.position - b.position).map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id as typeof tab)} style={{ flex: 1, padding: '9px 4px', fontSize: 12, border: 'none', background: 'transparent', cursor: 'pointer', borderBottom: tab === id ? '2px solid #6366f1' : '2px solid transparent', color: tab === id ? '#4338ca' : '#64748b', fontWeight: tab === id ? 600 : 400 }}>{label}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

          {tab === 'info' && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase', marginBottom: 8 }}>MAGASIN</div>
              {[['Enseigne', brand?.name], ['Nom', store?.name], ['Ville', store?.city], ['Département', store?.department], ['Adresse', store?.address], ['SIRET', store?.siret]].map(([l, v]) => v && (
                <div key={l} style={{ display: 'flex', gap: 8, fontSize: 12, marginBottom: 5 }}>
                  <span style={{ width: 110, flexShrink: 0, color: '#94a3b8' }}>{l}</span>
                  <span style={{ color: '#334155' }}>{v}</span>
                </div>
              ))}

              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase', margin: '14px 0 8px' }}>ASSIGNÉ À</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                <button onClick={() => assignCollaborator(null)}
                  style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', border: '1px solid', background: !currentCollab ? '#eef2ff' : '#f1f5f9', color: !currentCollab ? '#4338ca' : '#64748b', borderColor: !currentCollab ? '#6366f1' : '#e2e8f0', fontWeight: !currentCollab ? 600 : 400 }}>
                  Non assigné
                </button>
                {collaborators.map(c => (
                  <button key={c.id} onClick={() => assignCollaborator(c.id)}
                    style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', border: '1px solid', display: 'flex', alignItems: 'center', gap: 5, background: currentCollab?.id === c.id ? c.color + '22' : '#f1f5f9', color: currentCollab?.id === c.id ? c.color : '#64748b', borderColor: currentCollab?.id === c.id ? c.color : '#e2e8f0', fontWeight: currentCollab?.id === c.id ? 600 : 400 }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: c.color, color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(c.name)}</span>
                    {c.name}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase' }}>CONTACTS</div>
                <button onClick={() => setEditContacts(!editContacts)} style={{ fontSize: 11, color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                  {editContacts ? 'Annuler' : '✎ Modifier'}
                </button>
              </div>

              {editContacts ? (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                  {[['Directeur', 'directeur', 'Prénom Nom'], ['Contact calling', 'contactCalling', 'Prénom Nom'], ['Email', 'dealEmail', 'contact@magasin.fr']].map(([label, key, ph]) => (
                    <div key={key} style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3 }}>{label}</label>
                      <input style={inp} placeholder={ph} value={(contacts as any)[key]} onChange={e => setContacts(c => ({ ...c, [key]: e.target.value }))} />
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={btnPri} onClick={saveContacts}>Enregistrer</button>
                    <button style={btnDef} onClick={() => setEditContacts(false)}>Annuler</button>
                  </div>
                </div>
              ) : (
                [['Directeur', deal.directeur], ['Contact calling', deal.contactCalling], ['Email', deal.dealEmail]].map(([l, v]) => (
                  <div key={l} style={{ display: 'flex', gap: 8, fontSize: 12, marginBottom: 5 }}>
                    <span style={{ width: 110, flexShrink: 0, color: '#94a3b8' }}>{l}</span>
                    <span style={{ color: v ? '#334155' : '#cbd5e1' }}>{v || '—'}</span>
                  </div>
                ))
              )}

              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase', margin: '14px 0 8px' }}>CRM</div>
              {[['Créé le', formatDate(deal.createdAt)], ['Dernier import', formatDate(deal.lastImportAt)], ['Priorité', deal.priority]].map(([l, v]) => v && v !== '—' && (
                <div key={l} style={{ display: 'flex', gap: 8, fontSize: 12, marginBottom: 5 }}>
                  <span style={{ width: 110, flexShrink: 0, color: '#94a3b8' }}>{l}</span>
                  <span style={{ color: '#334155' }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {tab === 'offers' && (
            <div>
              {!dOffers.length && <p style={{ color: '#94a3b8', fontSize: 13 }}>Aucune offre.</p>}
              {dOffers.map((o: any) => (
                <div key={o.id} style={{ border: '1px solid #e2e8f0', borderRadius: 9, padding: '10px 12px', background: '#f8fafc', marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{o.title || o.jobTitle || '—'}</div>
                      {o.jobTitle && o.jobTitle !== o.title && <div style={{ fontSize: 11, color: '#64748b' }}>{o.jobTitle}</div>}
                    </div>
                    <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, fontWeight: 500, background: o.status === 'active' ? '#dcfce7' : '#fee2e2', color: o.status === 'active' ? '#15803d' : '#b91c1c' }}>{o.status === 'active' ? 'active' : 'disparue'}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11, color: '#64748b', marginBottom: 4 }}>
                    {o.contractType && <span>📄 {o.contractType}</span>}
                    {o.salary && <span>💰 {o.salary}</span>}
                    {o.source && <span>🔗 {o.source}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>Vue du {formatDate(o.firstSeenAt)} au {formatDate(o.lastSeenAt)}</div>
                  {o.url && <a href={o.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#6366f1', display: 'block', marginTop: 4 }}>→ Voir l'offre</a>}
                </div>
              ))}
            </div>
          )}

          {tab === 'actions' && (
            <div>
              <button style={{ ...btnPri, marginBottom: 12 }} onClick={() => setAF({ title: '', type: 'Appeler', dueDate: new Date().toISOString().slice(0, 10), priority: 'normale', note: '', dueTime: '' } as any)}>+ Nouvelle action</button>
              {actionForm && (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <input style={{ ...inp, gridColumn: '1/-1' }} placeholder="Titre *" value={actionForm.title || ''} onChange={e => setAF(f => ({ ...f, title: e.target.value }))} />
                    <select style={inp} value={actionForm.type || 'Appeler'} onChange={e => setAF(f => ({ ...f, type: e.target.value as Action['type'] }))}>{ACTION_TYPES.map(t => <option key={t}>{t}</option>)}</select>
                    <select style={inp} value={actionForm.priority || 'normale'} onChange={e => setAF(f => ({ ...f, priority: e.target.value as Priority }))}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select>
                    <input type="date" style={inp} value={typeof actionForm.dueDate === 'string' ? actionForm.dueDate.slice(0, 10) : ''} onChange={e => setAF(f => ({ ...f, dueDate: e.target.value }))} />
                    <input type="time" style={inp} value={(actionForm as any).dueTime || ''} onChange={e => setAF(f => ({ ...f, dueTime: e.target.value } as any))} />
                    <textarea style={{ ...inp, height: 40, resize: 'none', gridColumn: '1/-1' }} placeholder="Note…" value={actionForm.note || ''} onChange={e => setAF(f => ({ ...f, note: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={btnPri} onClick={saveAction}>Enregistrer</button>
                    <button style={btnDef} onClick={() => setAF(null)}>Annuler</button>
                  </div>
                </div>
              )}
              {!dActions.length && !actionForm && <p style={{ color: '#94a3b8', fontSize: 13 }}>Aucune action.</p>}
              {dActions.map((a: any) => {
                const late = a.status === 'todo' && isOverdue(a.dueDate) && new Date(a.dueDate).toDateString() !== new Date().toDateString();
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 11px', borderRadius: 8, border: `1px solid ${late ? '#fecaca' : '#e2e8f0'}`, background: late ? '#fef2f2' : '#f8fafc', marginBottom: 5 }}>
                    <button onClick={() => a.status === 'todo' && doneAction(a.id)} style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${a.status === 'done' ? '#16a34a' : '#cbd5e1'}`, background: a.status === 'done' ? '#16a34a' : 'transparent', cursor: 'pointer', flexShrink: 0, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10 }}>
                      {a.status === 'done' && '✓'}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, textDecoration: a.status === 'done' ? 'line-through' : 'none', color: a.status === 'done' ? '#94a3b8' : '#0f172a' }}>{a.title}</div>
                      <div style={{ display: 'flex', gap: 5, marginTop: 2, fontSize: 11, color: late ? '#dc2626' : '#64748b', flexWrap: 'wrap' }}>
                        <span style={{ background: '#eef2ff', color: '#4338ca', padding: '1px 5px', borderRadius: 3 }}>{a.type}</span>
                        {formatRelativeDate(a.dueDate)}
                        {a.dueTime && <span>à {a.dueTime}</span>}
                        {a.note && <span style={{ color: '#94a3b8' }}>{a.note.slice(0, 40)}</span>}
                      </div>
                    </div>
                    <button onClick={() => setAF({ ...a, dueDate: typeof a.dueDate === 'string' ? a.dueDate.slice(0, 10) : '' })} style={{ ...btnDef, padding: '2px 6px', fontSize: 11 }}>✎</button>
                    <button onClick={() => deleteAction(a.id)} style={{ ...btnDef, padding: '2px 6px', fontSize: 11 }}>🗑</button>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'notes' && (
            <div>
              <textarea style={{ ...inp, height: 60, resize: 'none', marginBottom: 8 }} placeholder="Ajouter une note…" value={noteText} onChange={e => setNote(e.target.value)} />
              <button style={{ ...btnPri, marginBottom: 14 }} onClick={addNote}>Ajouter la note</button>
              {!dNotes.length && <p style={{ color: '#94a3b8', fontSize: 13 }}>Aucune note.</p>}
              {dNotes.map((n: Note) => (
                <div key={n.id} style={{ border: '1px solid #e2e8f0', borderRadius: 9, padding: '10px 12px', background: '#fff', marginBottom: 8 }}>
                  <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginBottom: 5 }}>{n.content}</p>
                  <p style={{ fontSize: 10, color: '#94a3b8' }}>{formatDate(n.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
