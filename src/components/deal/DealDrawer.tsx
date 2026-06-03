'use client';
import { useState, useEffect, useCallback } from 'react';
import type { Action, Note, Priority } from '@/types';
import { formatDate, isOverdue } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';

const inp: React.CSSProperties = { width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: 12, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '5px 10px', borderRadius: 6, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 11 };
const btnDef: React.CSSProperties = { padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 11 };

interface Collaborator { id: string; name: string; color: string; email: string; }
interface EmailTemplate { id: string; name: string; subject: string; body: string; }
interface EmailLog { id: string; to: string; subject: string; body: string; sentAt: string; status: string; openedAt?: string; }
interface Props { dealId: string; onClose: () => void; onUpdated: () => void; }

function initials(name: string) { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }
function replaceVars(text: string, vars: Record<string, string>) { return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] || ''); }

const ACTION_TYPES = ['Appeler', 'Email', 'Relancer', 'Démo', 'Autre'];
const PRIORITIES: Priority[] = ['faible', 'normale', 'élevée', 'urgente'];

export default function DealDrawer({ dealId, onClose, onUpdated }: Props) {
  const [deal, setDeal] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [editContacts, setEditContacts] = useState(false);
  const [editCommercial, setEditCommercial] = useState(false);
  const [contacts, setContacts] = useState({ directeur: '', contactCalling: '', dealEmail: '', contactCivilite: 'Monsieur', contactLastName: '', dealValue: '', demoDate: '' });
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  const [noteText, setNote] = useState('');
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [civilite, setCivilite] = useState('Monsieur');
  const [editingAction, setEditingAction] = useState<any | null>(null);
  const [editActionForm, setEditActionForm] = useState({ title: '', type: 'Appeler', dueDate: '', dueTime: '', priority: 'normale' as Priority });
  const [showCreateAction, setShowCreateAction] = useState(false);
  const [newActionForm, setNewActionForm] = useState({ title: '', type: 'Appeler', dueDate: '', dueTime: '', priority: 'normale' as Priority });

  const fetchDeal = useCallback(async () => {
    const res = await fetch(`/api/deals/${dealId}`);
    if (res.ok) {
      const d = await res.json();
      setDeal(d);
      setContacts({ directeur: d.directeur || '', contactCalling: d.contactCalling || '', dealEmail: d.dealEmail || '', contactCivilite: d.contactCivilite || 'Monsieur', contactLastName: d.contactLastName || '', dealValue: d.dealValue ? d.dealValue.toString() : '', demoDate: d.demoDate ? d.demoDate.split('T')[0] : '' });
      setEmailTo(d.dealEmail || '');
    }
    setLoading(false);
  }, [dealId]);

  const fetchEmailLogs = useCallback(async () => {
    const res = await fetch(`/api/emails?dealId=${dealId}`);
    if (res.ok) setEmailLogs(await res.json());
  }, [dealId]);

  useEffect(() => { fetchDeal(); fetchEmailLogs(); }, [fetchDeal, dealId]);
  useEffect(() => { fetch('/api/collaborators').then(r => r.json()).then(setCollaborators).catch(() => {}); }, []);
  useEffect(() => { fetch('/api/columns').then(r => r.json()).then(setColumns).catch(() => {}); }, []);
  useEffect(() => { fetch('/api/email-templates').then(r => r.json()).then(setTemplates).catch(() => {}); }, []);

  const getVars = (d: any) => ({ civilite, enseigne: d?.store?.brand?.name || '', nom_magasin: d?.store?.name || '', ville: d?.store?.city || '', directeur: d?.directeur || '', contact_calling: d?.contactCalling || '', poste: d?.jobOffers?.[0]?.jobTitle || '', prenom_expediteur: '' });

  const applyTemplate = (templateId: string) => {
    const tpl = templates.find(t => t.id === templateId);
    if (!tpl || !deal) return;
    const vars = getVars(deal);
    setEmailSubject(replaceVars(tpl.subject, vars));
    setEmailBody(replaceVars(tpl.body, vars));
    setSelectedTemplate(templateId);
  };

  const sendEmail = async () => {
    if (!emailTo || !emailSubject || !emailBody) { toast('Destinataire, sujet et corps requis', 'error'); return; }
    setSendingEmail(true);
    try {
      const res = await fetch('/api/emails', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dealId, templateId: selectedTemplate || null, to: emailTo, subject: emailSubject, body: emailBody }) });
      if (!res.ok) throw new Error((await res.json()).error);
      toast('✓ Email envoyé !');
      setEmailSubject(''); setEmailBody(''); setSelectedTemplate(''); setShowEmailForm(false);
      fetchEmailLogs();
    } catch (e) {
      toast((e as Error).message || 'Erreur envoi', 'error');
    } finally { setSendingEmail(false); }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dealId, content: noteText }) });
    setNote(''); setShowNoteForm(false); fetchDeal(); onUpdated();
  };

  const moveToColumn = async (columnId: string) => {
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columnId }) });
    fetchDeal(); onUpdated(); toast('Étape mise à jour');
  };

  const saveContacts = async () => {
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ directeur: contacts.directeur, contactCalling: contacts.contactCalling, dealEmail: contacts.dealEmail, contactCivilite: contacts.contactCivilite, contactLastName: contacts.contactLastName }) });
    setEditContacts(false); fetchDeal(); onUpdated(); toast('Contacts mis à jour');
  };

  const saveCommercial = async () => {
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dealValue: contacts.dealValue ? parseFloat(contacts.dealValue) : null, demoDate: contacts.demoDate ? new Date(contacts.demoDate).toISOString() : null }) });
    setEditCommercial(false); fetchDeal(); onUpdated(); toast('Données commerciales mises à jour');
  };

  const assignCollaborator = async (collaboratorId: string | null) => {
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collaboratorId }) });
    fetchDeal(); onUpdated(); toast('Assignation mise à jour');
  };

  const editAction = (action: any) => {
    const dateStr = action.dueDate.split('T')[0];
    const timeStr = action.dueDate.split('T')[1]?.slice(0, 5) || '09:00';
    setEditingAction(action);
    setEditActionForm({ title: action.title, type: action.type, dueDate: dateStr, dueTime: timeStr, priority: action.priority });
  };

  const saveAction = async () => {
    if (!editingAction) return;
    const dueDateTime = `${editActionForm.dueDate}T${editActionForm.dueTime}:00`;
    await fetch(`/api/actions/${editingAction.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: editActionForm.title, type: editActionForm.type, dueDate: new Date(dueDateTime).toISOString(), priority: editActionForm.priority }) });
    setEditingAction(null); fetchDeal(); onUpdated(); toast('Action mise à jour');
  };

  const createAction = async () => {
    if (!newActionForm.title.trim() || !newActionForm.dueDate) { toast('Titre et date requis', 'error'); return; }
    const dueDateTime = `${newActionForm.dueDate}T${newActionForm.dueTime}:00`;
    await fetch('/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dealId, title: newActionForm.title, type: newActionForm.type, dueDate: new Date(dueDateTime).toISOString(), priority: newActionForm.priority }) });
    setNewActionForm({ title: '', type: 'Appeler', dueDate: '', dueTime: '', priority: 'normale' }); setShowCreateAction(false); fetchDeal(); onUpdated(); toast('Action créée');
  };

  const completeAction = async (actionId: string) => {
    await fetch(`/api/actions/${actionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
    fetchDeal(); onUpdated(); toast('Action complétée');
  };

  const deleteAction = async (actionId: string) => {
    await fetch(`/api/actions/${actionId}`, { method: 'DELETE' });
    fetchDeal(); onUpdated(); toast('Action supprimée');
  };

  if (loading || !deal) return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,.3)', display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: '66.66vw', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#94a3b8' }}>Chargement…</span>
      </div>
    </div>
  );

  const store = deal.store;
  const brand = store?.brand;
  const bc = brand?.color || '#6366f1';
  const currentCollab = deal.collaborator as Collaborator | null;
  const timeline = [...(deal.notes || []).map((n: any) => ({ type: 'note', data: n, date: new Date(n.createdAt) })), ...emailLogs.map((e: EmailLog) => ({ type: 'email', data: e, date: new Date(e.sentAt) }))].sort((a, b) => b.date.getTime() - a.date.getTime());
  const pipelineColumns = (deal.column ? [deal.column] : []).concat((columns.filter((c: any) => c.pipelineId === deal.column?.pipelineId && c.id !== deal.column?.id) || [])).sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
  const dActions = deal.actions?.sort((a: any, b: any) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime()) ?? [];
  const todoActions = dActions.filter((a: any) => a.status !== 'completed');

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,.3)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '66.66vw', height: '100%', background: '#fff', borderLeft: '1px solid #e2e8f0', display: 'flex', overflow: 'hidden' }}>

        {/* LEFT: 1/3 - INFOS */}
        <div style={{ width: '33.33%', display: 'flex', flexDirection: 'column', overflowY: 'auto', borderRight: '1px solid #e2e8f0', minWidth: 0 }}>
          <div style={{ padding: '18px' }}>

            {/* HEADER */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {brand && <div style={{ fontSize: 12, fontWeight: 700, color: bc, marginBottom: 1 }}>{brand.name}</div>}
                <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{store?.name}</div>
              </div>
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#94a3b8', padding: 0, flexShrink: 0 }}>×</button>
            </div>

            {/* MAGASIN */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>MAGASIN</div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 5, padding: 8, background: '#f8fafc', fontSize: 14 }}>
                {[['Enseigne', brand?.name], ['Ville', store?.city]].map(([l, v]) => v && (
                  <div key={l} style={{ display: 'flex', gap: 3, marginBottom: 2 }}>
                    <span style={{ width: 50, flexShrink: 0, color: '#64748b', fontWeight: 600, fontSize: 9 }}>{l}</span>
                    <span style={{ color: '#334155', fontSize: 9, wordBreak: 'break-word' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* CONTACTS */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>CONTACTS</div>
                <button onClick={() => setEditContacts(!editContacts)} style={{ fontSize: 8, color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{editContacts ? '✕' : '✎'}</button>
              </div>
              
              {editContacts ? (
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 5, padding: 6 }}>
                  {[['Civilité', 'civility'], ['Nom', 'name'], ['Dir.', 'directeur'], ['Tél', 'contactCalling'], ['Email', 'dealEmail']].map(([label, key]) => (
                    <div key={key} style={{ marginBottom: 5 }}>
                      <label style={{ fontSize: 14, color: '#64748b', display: 'block', marginBottom: 1, fontWeight: 600 }}>{label}</label>
                      {key === 'civility' ? (
                        <select style={inp} value={contacts.contactCivilite} onChange={e => setContacts(c => ({ ...c, contactCivilite: e.target.value }))}>
                          <option>Monsieur</option>
                          <option>Madame</option>
                        </select>
                      ) : (
                        <input style={{ ...inp, padding: '4px 6px', fontSize: 12 }} value={key === 'name' ? contacts.contactLastName : contacts[key as keyof typeof contacts]} onChange={e => {
                          if (key === 'name') setContacts(c => ({ ...c, contactLastName: e.target.value }));
                          else setContacts(c => ({ ...c, [key]: e.target.value }));
                        }} />
                      )}
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 3, marginTop: 5 }}>
                    <button style={btnPri} onClick={saveContacts}>OK</button>
                    <button style={btnDef} onClick={() => setEditContacts(false)}>✕</button>
                  </div>
                </div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 5, padding: 6, background: '#f8fafc', fontSize: 9 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{contacts.contactCivilite} {contacts.contactLastName}</div>
                  {contacts.directeur && <div style={{ color: '#64748b', fontSize: 8 }}><strong>Dir :</strong> {contacts.directeur}</div>}
                  {contacts.contactCalling && <div style={{ color: '#64748b', fontSize: 8 }}><strong>Tel :</strong> {contacts.contactCalling}</div>}
                  {contacts.dealEmail && <div style={{ color: '#64748b', fontSize: 8 }}><strong>Email :</strong> {contacts.dealEmail}</div>}
                </div>
              )}
            </div>

            {/* OFFRES */}
            {deal.jobOffers && deal.jobOffers.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>OFFRES</div>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 5, padding: 4, background: '#f8fafc' }}>
                  {deal.jobOffers.map((offer: any) => (
                    <div key={offer.id} style={{ fontSize: 8, marginBottom: 4, paddingBottom: 4, borderBottom: '1px solid #e2e8f0' }}>
                      <div style={{ fontWeight: 600, color: '#334155' }}>{offer.jobTitle}</div>
                      {offer.firstSeenAt && <div style={{ color: '#94a3b8', fontSize: 7 }}>{formatDate(offer.firstSeenAt)}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* COMMERCIAL */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>COMMERCIAL</div>
                <button onClick={() => setEditCommercial(!editCommercial)} style={{ fontSize: 8, color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{editCommercial ? '✕' : '✎'}</button>
              </div>

              {editCommercial ? (
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 5, padding: 6 }}>
                  <div style={{ marginBottom: 5 }}>
                    <label style={{ fontSize: 14, color: '#64748b', display: 'block', marginBottom: 1, fontWeight: 600 }}>Valeur €</label>
                    <input style={{ ...inp, padding: '4px 6px', fontSize: 12 }} type="number" value={contacts.dealValue} onChange={e => setContacts(c => ({ ...c, dealValue: e.target.value }))} />
                  </div>
                  <div style={{ marginBottom: 5 }}>
                    <label style={{ fontSize: 14, color: '#64748b', display: 'block', marginBottom: 1, fontWeight: 600 }}>DEMO</label>
                    <input style={{ ...inp, padding: '4px 6px', fontSize: 12 }} type="date" value={contacts.demoDate} onChange={e => setContacts(c => ({ ...c, demoDate: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', gap: 3 }}>
                    <button style={btnPri} onClick={saveCommercial}>OK</button>
                    <button style={btnDef} onClick={() => setEditCommercial(false)}>✕</button>
                  </div>
                </div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 5, padding: 6, background: '#f8fafc', fontSize: 9 }}>
                  {contacts.dealValue && <div style={{ fontWeight: 600, marginBottom: 2 }}>{contacts.dealValue} €</div>}
                  {contacts.demoDate && <div style={{ color: '#64748b', fontSize: 8 }}><strong>DEMO :</strong> {contacts.demoDate}</div>}
                  {!contacts.dealValue && !contacts.demoDate && <div style={{ color: '#94a3b8', fontSize: 8 }}>-</div>}
                </div>
              )}
            </div>

            {/* ASSIGNÉ */}
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>ASSIGNÉ</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                <button onClick={() => assignCollaborator(null)} style={{ padding: '3px 6px', borderRadius: 10, fontSize: 8, cursor: 'pointer', border: '1px solid', background: !currentCollab ? '#eef2ff' : '#f1f5f9', color: !currentCollab ? '#4338ca' : '#64748b', borderColor: !currentCollab ? '#6366f1' : '#e2e8f0', fontWeight: !currentCollab ? 600 : 400 }}>Non</button>
                {collaborators.map((c: any) => (
                  <button key={c.id} onClick={() => assignCollaborator(c.id)} style={{ padding: '3px 6px', borderRadius: 10, fontSize: 8, cursor: 'pointer', border: '1px solid', background: currentCollab?.id === c.id ? c.color + '22' : '#f1f5f9', color: currentCollab?.id === c.id ? c.color : '#64748b', borderColor: currentCollab?.id === c.id ? c.color : '#e2e8f0' }}>
                    {initials(c.name)}
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* RIGHT: 2/3 - ACTIONS, NOTES & EMAILS */}
        <div style={{ width: '66.66%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          
          {/* PIPELINE */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, background: '#fff', overflowX: 'auto' }}>
            <div style={{ display: 'flex', gap: 5 }}>
              {pipelineColumns.map((col: any, idx: number) => (
                <div key={col.id} style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                  <button onClick={() => moveToColumn(col.id)} style={{ padding: '5px 9px', borderRadius: 14, fontSize: 10, fontWeight: 500, cursor: 'pointer', border: 'none', background: deal.columnId === col.id ? '#4f46e5' : '#f1f5f9', color: deal.columnId === col.id ? '#fff' : '#64748b', whiteSpace: 'nowrap' }}>{col.title}</button>
                  {idx < pipelineColumns.length - 1 && <div style={{ fontSize: 11, color: '#cbd5e1', flexShrink: 0 }}>→</div>}
                </div>
              ))}
            </div>
          </div>

          {/* ACTIONS SECTION */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, background: '#fff', maxHeight: editingAction || showCreateAction ? '250px' : 'auto', overflowY: 'auto' }}>
            {editingAction ? (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 5, padding: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#334155', marginBottom: 6 }}>Éditer l'action</div>
                <input style={{ ...inp, marginBottom: 6, fontSize: 12 }} value={editActionForm.title} onChange={e => setEditActionForm(f => ({ ...f, title: e.target.value }))} placeholder="Titre" />
                <select style={{ ...inp, marginBottom: 6, fontSize: 12 }} value={editActionForm.type} onChange={e => setEditActionForm(f => ({ ...f, type: e.target.value }))}>
                  {ACTION_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                  <input style={{ ...inp, flex: 1, fontSize: 12 }} type="date" value={editActionForm.dueDate} onChange={e => setEditActionForm(f => ({ ...f, dueDate: e.target.value }))} />
                  <input style={{ ...inp, flex: 0.6, fontSize: 12 }} type="time" value={editActionForm.dueTime} onChange={e => setEditActionForm(f => ({ ...f, dueTime: e.target.value }))} />
                </div>
                <select style={{ ...inp, marginBottom: 6, fontSize: 12 }} value={editActionForm.priority} onChange={e => setEditActionForm(f => ({ ...f, priority: e.target.value as Priority }))}>
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button style={btnPri} onClick={saveAction}>✓ Sauver</button>
                  <button style={btnDef} onClick={() => setEditingAction(null)}>✕ Annuler</button>
                  <button style={{ ...btnDef, color: '#ef4444', borderColor: '#ef4444' }} onClick={() => { deleteAction(editingAction.id); setEditingAction(null); }}>🗑 Supprimer</button>
                </div>
              </div>
            ) : showCreateAction ? (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 5, padding: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#334155', marginBottom: 6 }}>Créer une action</div>
                <input style={{ ...inp, marginBottom: 6, fontSize: 12 }} value={newActionForm.title} onChange={e => setNewActionForm(f => ({ ...f, title: e.target.value }))} placeholder="Titre" />
                <select style={{ ...inp, marginBottom: 6, fontSize: 12 }} value={newActionForm.type} onChange={e => setNewActionForm(f => ({ ...f, type: e.target.value }))}>
                  {ACTION_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                  <input style={{ ...inp, flex: 1, fontSize: 12 }} type="date" value={newActionForm.dueDate} onChange={e => setNewActionForm(f => ({ ...f, dueDate: e.target.value }))} />
                  <input style={{ ...inp, flex: 0.6, fontSize: 12 }} type="time" value={newActionForm.dueTime} onChange={e => setNewActionForm(f => ({ ...f, dueTime: e.target.value }))} />
                </div>
                <select style={{ ...inp, marginBottom: 6, fontSize: 12 }} value={newActionForm.priority} onChange={e => setNewActionForm(f => ({ ...f, priority: e.target.value as Priority }))}>
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button style={btnPri} onClick={createAction}>✓ Créer</button>
                  <button style={btnDef} onClick={() => setShowCreateAction(false)}>✕ Annuler</button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#334155' }}>Actions ({todoActions.length})</div>
                  <button onClick={() => setShowCreateAction(true)} style={{ fontSize: 8, color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}>+ Créer</button>
                </div>
                {todoActions.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Aucune action</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {todoActions.map((action: any) => (
                      <div key={action.id} onClick={() => editAction(action)} style={{ border: '1px solid #e2e8f0', borderRadius: 5, padding: 6, background: '#f8fafc', cursor: 'pointer', transition: 'all .2s' }}>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                          <input type="checkbox" onChange={() => completeAction(action.id)} style={{ marginTop: 2, cursor: 'pointer' }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: '#334155' }}>{action.title}</div>
                            <div style={{ fontSize: 14, color: '#64748b' }}>{action.type} • {formatDate(action.dueDate)}</div>
                          </div>
                          <span style={{ fontSize: 7, background: '#f59e0b', color: '#fff', padding: '2px 4px', borderRadius: 3, whiteSpace: 'nowrap' }}>{action.priority}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* NOTES & EMAILS BUTTONS */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, display: 'flex', gap: 6 }}>
            <button onClick={() => setShowNoteForm(!showNoteForm)} style={{ ...btnPri, flex: 1, fontSize: 10 }}>+ Note</button>
            <button onClick={() => setShowEmailForm(!showEmailForm)} style={{ ...btnPri, flex: 1, fontSize: 10 }}>📧 Email</button>
          </div>

          {/* NOTE FORM */}
          {showNoteForm && (
            <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <textarea style={{ ...inp, height: 50, resize: 'none', marginBottom: 6, fontSize: 10 }} placeholder="Note…" value={noteText} onChange={e => setNote(e.target.value)} />
              <div style={{ display: 'flex', gap: 4 }}>
                <button style={btnPri} onClick={addNote}>✓</button>
                <button style={btnDef} onClick={() => { setShowNoteForm(false); setNote(''); }}>✕</button>
              </div>
            </div>
          )}

          {/* EMAIL COMPOSER */}
          {showEmailForm && (
            <div style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', background: '#fff', maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              
              {/* TEMPLATE SELECTOR */}
              <div>
                <label style={{ fontSize: 8, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Template</label>
                <select style={{ ...inp, fontSize: 12 }} value={selectedTemplate} onChange={e => applyTemplate(e.target.value)}>
                  <option value="">Personnalisé</option>
                  {templates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              {/* TO */}
              <div>
                <label style={{ fontSize: 8, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Destinataire</label>
                <input style={{ ...inp, fontSize: 10, background: '#eef2ff', borderColor: '#6366f1' }} type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} />
              </div>

              {/* SUBJECT */}
              <div>
                <label style={{ fontSize: 8, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Sujet</label>
                <input style={{ ...inp, fontSize: 10 }} placeholder="Ex: Suivi de votre candidature" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
              </div>

              {/* BODY */}
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 8, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Message</label>
                <textarea style={{ ...inp, fontSize: 12, height: '100px', resize: 'none' }} placeholder="Écrivez votre message ici…" value={emailBody} onChange={e => setEmailBody(e.target.value)} />
              </div>

              {/* ACTIONS */}
              <div style={{ display: 'flex', gap: 4, borderTop: '1px solid #e2e8f0', paddingTop: 8 }}>
                <button onClick={sendEmail} disabled={sendingEmail} style={{ flex: 1, ...btnPri, fontSize: 10, opacity: sendingEmail ? 0.7 : 1 }}>
                  {sendingEmail ? '⏳ Envoi...' : '✉️ Envoyer'}
                </button>
                <button style={{ flex: 1, ...btnDef, fontSize: 10 }} onClick={() => { setShowEmailForm(false); setEmailSubject(''); setEmailBody(''); setSelectedTemplate(''); }}>
                  Annuler
                </button>
              </div>
            </div>
          )}

          {/* TIMELINE */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
            {timeline.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', paddingTop: 15, fontSize: 10 }}>Aucune note ou email</div>
            ) : (
              timeline.map((item) => (
                <div key={`${item.type}-${item.data.id}`} style={{ marginBottom: 8 }}>
                  {item.type === 'note' ? (
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 6, background: '#fafbfc' }}>
                      <div style={{ fontSize: 8, fontWeight: 700, color: '#94a3b8', marginBottom: 2 }}>📝 NOTE</div>
                      <p style={{ fontSize: 18, color: '#334155', whiteSpace: 'pre-wrap', margin: 0, marginBottom: 2 }}>{item.data.content}</p>
                      <div style={{ fontSize: 7, color: '#94a3b8' }}>{formatDate(item.data.createdAt)}</div>
                    </div>
                  ) : (
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 6, background: '#f0f4ff' }}>
                      <div style={{ fontSize: 8, fontWeight: 700, color: '#4338ca', marginBottom: 2 }}>📧 EMAIL</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 1 }}>{item.data.subject}</div>
                      <div style={{ fontSize: 14, color: '#64748b', marginBottom: 2 }}>→ {item.data.to}</div>
                      {item.data.status === 'opened' && <span style={{ fontSize: 7, background: '#dbeafe', color: '#1d4ed8', padding: '1px 3px', borderRadius: 2, fontWeight: 500 }}>👁 Ouvert</span>}
                      {item.data.status === 'sent' && <span style={{ fontSize: 7, background: '#dcfce7', color: '#15803d', padding: '1px 3px', borderRadius: 2, fontWeight: 500 }}>✓ Envoyé</span>}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
