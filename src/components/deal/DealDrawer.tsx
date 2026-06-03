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
interface EmailTemplate { id: string; name: string; subject: string; body: string; }
interface EmailLog { id: string; to: string; subject: string; body: string; sentAt: string; status: string; openedAt?: string; resendId?: string; template?: { name: string }; }
interface Props { dealId: string; onClose: () => void; onUpdated: () => void; }

function initials(name: string) { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }

function replaceVars(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] || '');
}

export default function DealDrawer({ dealId, onClose, onUpdated }: Props) {
  const [deal, setDeal] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [editContacts, setEditContacts] = useState(false);
  const [editCommercial, setEditCommercial] = useState(false);
  const [showActionForm, setShowActionForm] = useState(false);
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
  const [newAction, setNewAction] = useState({ title: '', type: 'Appeler', dueDate: '', dueTime: '', priority: 'normale' as Priority, note: '' });

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

  const getVars = (d: any) => ({
    civilite,
    enseigne: d?.store?.brand?.name || '',
    nom_magasin: d?.store?.name || '',
    ville: d?.store?.city || '',
    directeur: d?.directeur || '',
    contact_calling: d?.contactCalling || '',
    poste: d?.jobOffers?.[0]?.jobTitle || '',
    prenom_expediteur: '',
  });

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
      const res = await fetch('/api/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId, templateId: selectedTemplate || null, to: emailTo, subject: emailSubject, body: emailBody }),
      });
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

  const createAction = async () => {
    if (!newAction.title || !newAction.dueDate) { toast('Titre et date requis', 'error'); return; }
    const payload = {
      title: newAction.title,
      type: newAction.type,
      dueDate: new Date(newAction.dueDate).toISOString(),
      dueTime: newAction.dueTime,
      priority: newAction.priority,
      note: newAction.note,
      status: 'todo',
    };
    await fetch(`/api/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dealId, ...payload }) });
    setNewAction({ title: '', type: 'Appeler', dueDate: '', dueTime: '', priority: 'normale', note: '' });
    setShowActionForm(false);
    fetchDeal();
    onUpdated();
    toast('✓ Action créée');
  };

  const completeAction = async (actionId: string) => {
    await fetch(`/api/actions/${actionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
    fetchDeal();
    onUpdated();
    toast('✓ Action complétée');
  };

  const moveToColumn = async (columnId: string) => {
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columnId }) });
    fetchDeal(); onUpdated(); toast('Étape mise à jour');
  };

  const saveContacts = async () => {
    const payload = { 
      directeur: contacts.directeur,
      contactCalling: contacts.contactCalling,
      dealEmail: contacts.dealEmail,
      contactCivilite: contacts.contactCivilite,
      contactLastName: contacts.contactLastName,
    };
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setEditContacts(false); fetchDeal(); onUpdated(); toast('Contacts mis à jour');
  };

  const saveCommercial = async () => {
    const payload = {
      dealValue: contacts.dealValue ? parseFloat(contacts.dealValue) : null,
      demoDate: contacts.demoDate ? new Date(contacts.demoDate).toISOString() : null
    };
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setEditCommercial(false); fetchDeal(); onUpdated(); toast('Données commerciales mises à jour');
  };

  const assignCollaborator = async (collaboratorId: string | null) => {
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collaboratorId }) });
    fetchDeal(); onUpdated(); toast('Assignation mise à jour');
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
  const isWhite = bc === '#ffffff';
  const dOffers = deal.jobOffers?.sort((a: any, b: any) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime()) ?? [];
  const dNotes = deal.notes?.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) ?? [];
  const dActions = deal.actions?.sort((a: any, b: any) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime()) ?? [];
  const currentCollab = deal.collaborator as Collaborator | null;

  const todoActions = dActions.filter((a: any) => a.status !== 'completed');
  const completedActions = dActions.filter((a: any) => a.status === 'completed');

  const timeline = [
    ...dNotes.map((n: Note) => ({ type: 'note', data: n, date: new Date(n.createdAt) })),
    ...emailLogs.map((e: EmailLog) => ({ type: 'email', data: e, date: new Date(e.sentAt) })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  const priorityColors: Record<string, string> = {
    faible: '#10b981',
    normale: '#3b82f6',
    élevée: '#f59e0b',
    urgente: '#ef4444',
  };

  const pipelineColumns = columns.filter((c: any) => c.pipelineId === deal.column?.pipelineId).sort((a: any, b: any) => a.position - b.position);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,.3)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '66.66vw', height: '100%', background: '#fff', borderLeft: '1px solid #e2e8f0', display: 'flex', overflow: 'hidden' }}>

        {/* LEFT: INFO (1/3 du drawer = 1/6 de l'écran) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', borderRight: '1px solid #e2e8f0' }}>
          <div style={{ padding: '20px 16px' }}>

            {/* HEADER */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {brand && <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: isWhite ? '#2563eb' : bc, marginBottom: 3 }}>{brand.name}</div>}
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{store?.name}</div>
              </div>
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#94a3b8', padding: 0 }}>×</button>
            </div>

            {/* MAGASIN */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase', marginBottom: 10 }}>📍 MAGASIN</div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 13, background: '#f8fafc' }}>
                {[['Enseigne', brand?.name], ['Ville', store?.city], ['Département', store?.department]].map(([l, v]) => v && (
                  <div key={l} style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 6, alignItems: 'center' }}>
                    <span style={{ width: 80, flexShrink: 0, color: '#64748b', fontWeight: 600 }}>{l}</span>
                    <span style={{ color: '#334155', flex: 1 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* CONTACTS */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase' }}>👤 CONTACTS</div>
                <button onClick={() => setEditContacts(!editContacts)} style={{ fontSize: 11, color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>{editContacts ? '✕' : '✎'}</button>
              </div>
              
              {editContacts ? (
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4, fontWeight: 600 }}>Civilité</label>
                    <select style={inp} value={contacts.contactCivilite} onChange={e => setContacts(c => ({ ...c, contactCivilite: e.target.value }))}>
                      <option>Monsieur</option>
                      <option>Madame</option>
                    </select>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4, fontWeight: 600 }}>Nom de famille</label>
                    <input style={{ ...inp, padding: '8px 10px', fontSize: 12 }} placeholder="Dupont" value={contacts.contactLastName} onChange={e => setContacts(c => ({ ...c, contactLastName: e.target.value }))} />
                  </div>
                  {[['Directeur', 'directeur'], ['Contact calling', 'contactCalling'], ['Email', 'dealEmail']].map(([label, key]) => (
                    <div key={key} style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4, fontWeight: 600 }}>{label}</label>
                      <input style={{ ...inp, padding: '8px 10px', fontSize: 12 }} value={contacts[key as keyof typeof contacts]} onChange={e => setContacts(c => ({ ...c, [key]: e.target.value }))} />
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={btnPri} onClick={saveContacts}>Enregistrer</button>
                    <button style={btnDef} onClick={() => setEditContacts(false)}>Annuler</button>
                  </div>
                </div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 13, background: '#f8fafc' }}>
                  <div style={{ fontSize: 13, color: '#334155', marginBottom: 6 }}>
                    <strong>Contact principal :</strong> {contacts.contactCivilite} {contacts.contactLastName}
                  </div>
                  {contacts.directeur && <div style={{ fontSize: 12, color: '#64748b', marginBottom: 3 }}><strong>Dir. :</strong> {contacts.directeur}</div>}
                  {contacts.contactCalling && <div style={{ fontSize: 12, color: '#64748b', marginBottom: 3 }}><strong>Tel :</strong> {contacts.contactCalling}</div>}
                  {contacts.dealEmail && <div style={{ fontSize: 12, color: '#64748b' }}><strong>Email :</strong> {contacts.dealEmail}</div>}
                </div>
              )}
            </div>

            {/* OFFRE COMMERCIALE */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase' }}>💼 OFFRE</div>
                <button onClick={() => setEditCommercial(!editCommercial)} style={{ fontSize: 11, color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>{editCommercial ? '✕' : '✎'}</button>
              </div>

              {editCommercial ? (
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4, fontWeight: 600 }}>Valeur (€)</label>
                    <input style={{ ...inp, padding: '8px 10px', fontSize: 12 }} type="number" placeholder="5000" value={contacts.dealValue} onChange={e => setContacts(c => ({ ...c, dealValue: e.target.value }))} />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4, fontWeight: 600 }}>Date DEMO</label>
                    <input style={{ ...inp, padding: '8px 10px', fontSize: 12 }} type="date" value={contacts.demoDate} onChange={e => setContacts(c => ({ ...c, demoDate: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={btnPri} onClick={saveCommercial}>Enregistrer</button>
                    <button style={btnDef} onClick={() => setEditCommercial(false)}>Annuler</button>
                  </div>
                </div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 13, background: '#f8fafc' }}>
                  {contacts.dealValue && <div style={{ fontSize: 13, color: '#334155', marginBottom: 6 }}><strong>{contacts.dealValue} €</strong></div>}
                  {contacts.demoDate && <div style={{ fontSize: 12, color: '#64748b' }}><strong>DEMO :</strong> {contacts.demoDate}</div>}
                  {!contacts.dealValue && !contacts.demoDate && <div style={{ fontSize: 12, color: '#94a3b8' }}>Aucune donnée</div>}
                </div>
              )}
            </div>

            {/* ACTIONS */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase' }}>✓ ACTIONS</div>
                <button onClick={() => setShowActionForm(!showActionForm)} style={{ fontSize: 11, color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>+ Programmer</button>
              </div>

              {showActionForm && (
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                  <input style={{ ...inp, marginBottom: 8 }} placeholder="Titre *" value={newAction.title} onChange={e => setNewAction(a => ({ ...a, title: e.target.value }))} />
                  <select style={{ ...inp, marginBottom: 8 }} value={newAction.type} onChange={e => setNewAction(a => ({ ...a, type: e.target.value }))}>
                    {ACTION_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input style={{ ...inp, flex: 1 }} type="date" value={newAction.dueDate} onChange={e => setNewAction(a => ({ ...a, dueDate: e.target.value }))} />
                    <input style={{ ...inp, flex: 1 }} type="time" value={newAction.dueTime} onChange={e => setNewAction(a => ({ ...a, dueTime: e.target.value }))} />
                  </div>
                  <select style={{ ...inp, marginBottom: 8 }} value={newAction.priority} onChange={e => setNewAction(a => ({ ...a, priority: e.target.value as Priority }))}>
                    {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                  </select>
                  <textarea style={{ ...inp, height: 60, resize: 'none', marginBottom: 8 }} placeholder="Note…" value={newAction.note} onChange={e => setNewAction(a => ({ ...a, note: e.target.value }))} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={btnPri} onClick={createAction}>Créer</button>
                    <button style={btnDef} onClick={() => setShowActionForm(false)}>Annuler</button>
                  </div>
                </div>
              )}

              {todoActions.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {todoActions.map((a: any) => (
                    <div key={a.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <input type="checkbox" onChange={() => completeAction(a.id)} style={{ marginTop: 2, cursor: 'pointer' }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 2 }}>{a.title}</div>
                          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>{a.type}</div>
                          {a.dueDate && <div style={{ fontSize: 10, color: isOverdue(a.dueDate) ? '#ef4444' : '#64748b' }}>{formatDate(a.dueDate)}</div>}
                        </div>
                        {a.priority && (
                          <span style={{ background: priorityColors[a.priority], color: '#fff', padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 500 }}>{a.priority}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {completedActions.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', fontWeight: 600 }}>Complétées</div>
                  {completedActions.map((a: any) => (
                    <div key={a.id} style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 8, padding: 10, marginBottom: 8, opacity: 0.7 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <input type="checkbox" checked disabled style={{ marginTop: 2, cursor: 'pointer' }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 2, textDecoration: 'line-through' }}>{a.title}</div>
                          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>{a.type}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {todoActions.length === 0 && completedActions.length === 0 && (
                <div style={{ fontSize: 11, color: '#cbd5e1', textAlign: 'center', padding: '12px 0' }}>Aucune action</div>
              )}
            </div>

            {/* ASSIGNÉ */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase', marginBottom: 10 }}>👥 ASSIGNÉ À</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button onClick={() => assignCollaborator(null)} style={{ padding: '6px 10px', borderRadius: 18, fontSize: 11, cursor: 'pointer', border: '1px solid', background: !currentCollab ? '#eef2ff' : '#f1f5f9', color: !currentCollab ? '#4338ca' : '#64748b', borderColor: !currentCollab ? '#6366f1' : '#e2e8f0', fontWeight: !currentCollab ? 600 : 400 }}>Non assigné</button>
                {collaborators.map((c: any) => (
                  <button key={c.id} onClick={() => assignCollaborator(c.id)} style={{ padding: '6px 10px', borderRadius: 18, fontSize: 11, cursor: 'pointer', border: '1px solid', display: 'flex', alignItems: 'center', gap: 4, background: currentCollab?.id === c.id ? c.color + '22' : '#f1f5f9', color: currentCollab?.id === c.id ? c.color : '#64748b', borderColor: currentCollab?.id === c.id ? c.color : '#e2e8f0', fontWeight: currentCollab?.id === c.id ? 600 : 400 }}>
                    <span style={{ width: 16, height: 16, borderRadius: '50%', background: c.color, color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(c.name)}</span>
                    <span style={{ fontSize: 11 }}>{c.name}</span>
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* RIGHT: FEED (2/3 du drawer = 2/3 de l'écran) */}
        <div style={{ flex: 2, display: 'flex', flexDirection: 'column' }}>
          
          {/* PIPELINE TIMELINE */}
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', paddingBottom: 8 }}>
              {pipelineColumns.map((col: any, idx: number) => {
                const isCurrentColumn = deal.columnId === col.id;
                return (
                  <div key={col.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => moveToColumn(col.id)}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 20,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        border: 'none',
                        background: isCurrentColumn ? '#4f46e5' : '#f1f5f9',
                        color: isCurrentColumn ? '#fff' : '#64748b',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        transition: 'all .2s'
                      }}
                    >
                      {col.title}
                    </button>
                    {idx < pipelineColumns.length - 1 && (
                      <div style={{ fontSize: 16, color: '#cbd5e1', flexShrink: 0 }}>→</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* HEADER */}
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowNoteForm(!showNoteForm)} style={{ ...btnPri, flex: 1 }}>+ Ajouter une note</button>
              <button onClick={() => setShowEmailForm(!showEmailForm)} style={{ ...btnPri, flex: 1 }}>📧 Envoyer email</button>
            </div>
          </div>

          {/* NOTE FORM */}
          {showNoteForm && (
            <div style={{ padding: '12px 18px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <textarea style={{ ...inp, height: 80, resize: 'none', marginBottom: 8 }} placeholder="Ajouter une note…" value={noteText} onChange={e => setNote(e.target.value)} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={btnPri} onClick={addNote}>Enregistrer</button>
                <button style={btnDef} onClick={() => { setShowNoteForm(false); setNote(''); }}>Annuler</button>
              </div>
            </div>
          )}

          {/* EMAIL FORM */}
          {showEmailForm && (
            <div style={{ padding: '12px 18px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', maxHeight: 400, overflowY: 'auto' }}>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3, fontWeight: 500 }}>Template</label>
                <select style={inp} value={selectedTemplate} onChange={e => applyTemplate(e.target.value)}>
                  <option value="">— Choisir un template —</option>
                  {templates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3, fontWeight: 500 }}>Civilité</label>
                <select style={inp} value={civilite} onChange={e => { setCivilite(e.target.value); if (selectedTemplate) applyTemplate(selectedTemplate); }}>
                  <option>Monsieur</option>
                  <option>Madame</option>
                </select>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3, fontWeight: 500 }}>Destinataire *</label>
                <input style={inp} type="email" placeholder="contact@magasin.fr" value={emailTo} onChange={e => setEmailTo(e.target.value)} />
              </div>

              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3, fontWeight: 500 }}>Sujet *</label>
                <input style={inp} placeholder="Objet de l'email" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3, fontWeight: 500 }}>Message *</label>
                <textarea style={{ ...inp, height: 100, resize: 'none' }} placeholder="Corps de l'email…" value={emailBody} onChange={e => setEmailBody(e.target.value)} />
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={sendEmail} disabled={sendingEmail} style={{ ...btnPri, flex: 1, opacity: sendingEmail ? .7 : 1, cursor: sendingEmail ? 'not-allowed' : 'pointer' }}>
                  {sendingEmail ? '⟳ Envoi…' : '✓ Envoyer'}
                </button>
                <button style={{ ...btnDef, flex: 1 }} onClick={() => { setShowEmailForm(false); setEmailSubject(''); setEmailBody(''); setSelectedTemplate(''); }}>Annuler</button>
              </div>
            </div>
          )}

          {/* TIMELINE */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
            {timeline.length === 0 && (
              <div style={{ textAlign: 'center', color: '#94a3b8', paddingTop: 40 }}>
                <p style={{ fontSize: 13 }}>Aucune note ou email pour le moment.</p>
                <p style={{ fontSize: 12, marginTop: 8 }}>Commencez par ajouter une note ou envoyer un email.</p>
              </div>
            )}

            {timeline.map((item) => (
              <div key={`${item.type}-${item.data.id}`} style={{ marginBottom: 16 }}>
                {item.type === 'note' ? (
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: '#fafbfc' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>📝 NOTE</div>
                    <p style={{ fontSize: 13, color: '#334155', whiteSpace: 'pre-wrap', marginBottom: 6 }}>{item.data.content}</p>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>{formatDate(item.data.createdAt)}</div>
                  </div>
                ) : (
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: '#f0f4ff' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#4338ca', marginBottom: 2 }}>📧 EMAIL</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 2 }}>{item.data.subject}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>→ {item.data.to}</div>
                      </div>
                      {item.data.status === 'opened' && (
                        <span style={{ fontSize: 10, background: '#dbeafe', color: '#1d4ed8', padding: '3px 7px', borderRadius: 4, flexShrink: 0, fontWeight: 500 }}>👁 Ouvert</span>
                      )}
                      {item.data.status === 'sent' && (
                        <span style={{ fontSize: 10, background: '#dcfce7', color: '#15803d', padding: '3px 7px', borderRadius: 4, flexShrink: 0, fontWeight: 500 }}>✓ Envoyé</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 6 }}>
                      Envoyé le {formatDate(item.data.sentAt)}
                      {item.data.openedAt && <span> • Ouvert le {formatDate(item.data.openedAt)}</span>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
