'use client';
import { useState, useEffect, useCallback } from 'react';
import type { Action, Note, Priority } from '@/types';
import { formatDate, isOverdue } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';

const PRIORITIES: Priority[] = ['faible', 'normale', 'élevée', 'urgente'];
const ACTION_TYPES = ['Appeler', 'Email', 'Relancer', 'Démo', 'Autre'];
const inp: React.CSSProperties = { width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: 12, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '5px 10px', borderRadius: 6, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 11 };
const btnDef: React.CSSProperties = { padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 11 };

interface Collaborator { id: string; name: string; color: string; email: string; }
interface EmailTemplate { id: string; name: string; subject: string; body: string; }
interface EmailLog { id: string; to: string; subject: string; body: string; sentAt: string; status: string; openedAt?: string; resendId?: string; }
interface Props { dealId: string; onClose: () => void; onUpdated: () => void; }

function initials(name: string) { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }
function replaceVars(text: string, vars: Record<string, string>) { return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] || ''); }

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
  const pipelineColumns = columns.filter((c: any) => c.pipelineId === deal.column?.pipelineId).sort((a: any, b: any) => a.position - b.position);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,.3)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '66.66vw', height: '100%', background: '#fff', borderLeft: '1px solid #e2e8f0', display: 'flex', overflow: 'hidden' }}>

        {/* LEFT: INFO */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', borderRight: '1px solid #e2e8f0' }}>
          <div style={{ padding: '12px 12px' }}>

            {/* HEADER */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {brand && <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.3px', textTransform: 'uppercase', color: bc, marginBottom: 1 }}>{brand.name}</div>}
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{store?.name}</div>
              </div>
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#94a3b8', padding: 0 }}>×</button>
            </div>

            {/* MAGASIN */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 4 }}>MAGASIN</div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 8, background: '#f8fafc', fontSize: 11 }}>
                {[['Enseigne', brand?.name], ['Ville', store?.city]].map(([l, v]) => v && (
                  <div key={l} style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
                    <span style={{ width: 60, flexShrink: 0, color: '#64748b', fontWeight: 600, fontSize: 10 }}>{l}</span>
                    <span style={{ color: '#334155', fontSize: 10 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* CONTACTS */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: '.5px', textTransform: 'uppercase' }}>CONTACTS</div>
                <button onClick={() => setEditContacts(!editContacts)} style={{ fontSize: 9, color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{editContacts ? '✕' : '✎'}</button>
              </div>
              
              {editContacts ? (
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 8 }}>
                  <div style={{ marginBottom: 6 }}>
                    <label style={{ fontSize: 9, color: '#64748b', display: 'block', marginBottom: 2, fontWeight: 600 }}>Civilité</label>
                    <select style={inp} value={contacts.contactCivilite} onChange={e => setContacts(c => ({ ...c, contactCivilite: e.target.value }))}>
                      <option>Monsieur</option>
                      <option>Madame</option>
                    </select>
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <label style={{ fontSize: 9, color: '#64748b', display: 'block', marginBottom: 2, fontWeight: 600 }}>Nom</label>
                    <input style={{ ...inp, padding: '4px 6px', fontSize: 11 }} value={contacts.contactLastName} onChange={e => setContacts(c => ({ ...c, contactLastName: e.target.value }))} />
                  </div>
                  {[['Dir.', 'directeur'], ['Tél', 'contactCalling'], ['Email', 'dealEmail']].map(([label, key]) => (
                    <div key={key} style={{ marginBottom: 6 }}>
                      <label style={{ fontSize: 9, color: '#64748b', display: 'block', marginBottom: 2, fontWeight: 600 }}>{label}</label>
                      <input style={{ ...inp, padding: '4px 6px', fontSize: 11 }} value={contacts[key as keyof typeof contacts]} onChange={e => setContacts(c => ({ ...c, [key]: e.target.value }))} />
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button style={btnPri} onClick={saveContacts}>OK</button>
                    <button style={btnDef} onClick={() => setEditContacts(false)}>✕</button>
                  </div>
                </div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 8, background: '#f8fafc', fontSize: 10 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{contacts.contactCivilite} {contacts.contactLastName}</div>
                  {contacts.directeur && <div style={{ color: '#64748b' }}><strong>Dir :</strong> {contacts.directeur}</div>}
                  {contacts.contactCalling && <div style={{ color: '#64748b' }}><strong>Tel :</strong> {contacts.contactCalling}</div>}
                  {contacts.dealEmail && <div style={{ color: '#64748b' }}><strong>Email :</strong> {contacts.dealEmail}</div>}
                </div>
              )}
            </div>

            {/* OFFRE */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: '.5px', textTransform: 'uppercase' }}>OFFRE</div>
                <button onClick={() => setEditCommercial(!editCommercial)} style={{ fontSize: 9, color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{editCommercial ? '✕' : '✎'}</button>
              </div>

              {editCommercial ? (
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 8 }}>
                  <div style={{ marginBottom: 6 }}>
                    <label style={{ fontSize: 9, color: '#64748b', display: 'block', marginBottom: 2, fontWeight: 600 }}>Valeur €</label>
                    <input style={{ ...inp, padding: '4px 6px', fontSize: 11 }} type="number" value={contacts.dealValue} onChange={e => setContacts(c => ({ ...c, dealValue: e.target.value }))} />
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <label style={{ fontSize: 9, color: '#64748b', display: 'block', marginBottom: 2, fontWeight: 600 }}>DEMO</label>
                    <input style={{ ...inp, padding: '4px 6px', fontSize: 11 }} type="date" value={contacts.demoDate} onChange={e => setContacts(c => ({ ...c, demoDate: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button style={btnPri} onClick={saveCommercial}>OK</button>
                    <button style={btnDef} onClick={() => setEditCommercial(false)}>✕</button>
                  </div>
                </div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 8, background: '#f8fafc', fontSize: 10 }}>
                  {contacts.dealValue && <div style={{ fontWeight: 600, marginBottom: 2 }}>{contacts.dealValue} €</div>}
                  {contacts.demoDate && <div style={{ color: '#64748b' }}><strong>DEMO :</strong> {contacts.demoDate}</div>}
                  {!contacts.dealValue && !contacts.demoDate && <div style={{ color: '#94a3b8' }}>-</div>}
                </div>
              )}
            </div>

            {/* ASSIGNÉ */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 4 }}>ASSIGNÉ</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                <button onClick={() => assignCollaborator(null)} style={{ padding: '4px 8px', borderRadius: 12, fontSize: 10, cursor: 'pointer', border: '1px solid', background: !currentCollab ? '#eef2ff' : '#f1f5f9', color: !currentCollab ? '#4338ca' : '#64748b', borderColor: !currentCollab ? '#6366f1' : '#e2e8f0', fontWeight: !currentCollab ? 600 : 400 }}>Non</button>
                {collaborators.map((c: any) => (
                  <button key={c.id} onClick={() => assignCollaborator(c.id)} style={{ padding: '4px 8px', borderRadius: 12, fontSize: 10, cursor: 'pointer', border: '1px solid', display: 'flex', alignItems: 'center', gap: 2, background: currentCollab?.id === c.id ? c.color + '22' : '#f1f5f9', color: currentCollab?.id === c.id ? c.color : '#64748b', borderColor: currentCollab?.id === c.id ? c.color : '#e2e8f0', fontWeight: currentCollab?.id === c.id ? 600 : 400 }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', background: c.color, color: '#fff', fontSize: 7, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(c.name)}</span>
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* RIGHT: FEED */}
        <div style={{ flex: 2, display: 'flex', flexDirection: 'column' }}>
          
          {/* PIPELINE */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, background: '#fff', overflowX: 'auto' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {pipelineColumns.map((col: any, idx: number) => (
                <div key={col.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => moveToColumn(col.id)} style={{ padding: '6px 10px', borderRadius: 16, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: 'none', background: deal.columnId === col.id ? '#4f46e5' : '#f1f5f9', color: deal.columnId === col.id ? '#fff' : '#64748b', whiteSpace: 'nowrap', flexShrink: 0, transition: 'all .2s' }}>{col.title}</button>
                  {idx < pipelineColumns.length - 1 && <div style={{ fontSize: 13, color: '#cbd5e1', flexShrink: 0 }}>→</div>}
                </div>
              ))}
            </div>
          </div>

          {/* ACTIONS */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, display: 'flex', gap: 6 }}>
            <button onClick={() => setShowNoteForm(!showNoteForm)} style={{ ...btnPri, flex: 1, fontSize: 11 }}>+ Note</button>
            <button onClick={() => setShowEmailForm(!showEmailForm)} style={{ ...btnPri, flex: 1, fontSize: 11 }}>📧 Email</button>
          </div>

          {/* NOTE FORM */}
          {showNoteForm && (
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <textarea style={{ ...inp, height: 60, resize: 'none', marginBottom: 6 }} placeholder="Note…" value={noteText} onChange={e => setNote(e.target.value)} />
              <div style={{ display: 'flex', gap: 4 }}>
                <button style={btnPri} onClick={addNote}>✓</button>
                <button style={btnDef} onClick={() => { setShowNoteForm(false); setNote(''); }}>✕</button>
              </div>
            </div>
          )}

          {/* EMAIL FORM */}
          {showEmailForm && (
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', maxHeight: 300, overflowY: 'auto' }}>
              <select style={{ ...inp, marginBottom: 6 }} value={selectedTemplate} onChange={e => applyTemplate(e.target.value)}>
                <option value="">Template</option>
                {templates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <input style={{ ...inp, marginBottom: 6 }} type="email" placeholder="To" value={emailTo} onChange={e => setEmailTo(e.target.value)} />
              <input style={{ ...inp, marginBottom: 6 }} placeholder="Subject" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
              <textarea style={{ ...inp, height: 50, resize: 'none', marginBottom: 6 }} placeholder="Body" value={emailBody} onChange={e => setEmailBody(e.target.value)} />
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={sendEmail} disabled={sendingEmail} style={{ ...btnPri, flex: 1, opacity: sendingEmail ? .7 : 1 }}>{sendingEmail ? '...' : '✓'}</button>
                <button style={{ ...btnDef, flex: 1 }} onClick={() => { setShowEmailForm(false); setEmailSubject(''); setEmailBody(''); }}>✕</button>
              </div>
            </div>
          )}

          {/* TIMELINE */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
            {timeline.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', paddingTop: 20, fontSize: 11 }}>Aucune note ou email</div>
            ) : (
              timeline.map((item) => (
                <div key={`${item.type}-${item.data.id}`} style={{ marginBottom: 10 }}>
                  {item.type === 'note' ? (
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, background: '#fafbfc' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', marginBottom: 2 }}>📝 NOTE</div>
                      <p style={{ fontSize: 11, color: '#334155', whiteSpace: 'pre-wrap', marginBottom: 4, margin: 0 }}>{item.data.content}</p>
                      <div style={{ fontSize: 8, color: '#94a3b8' }}>{formatDate(item.data.createdAt)}</div>
                    </div>
                  ) : (
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, background: '#f0f4ff' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#4338ca', marginBottom: 2 }}>📧 EMAIL</div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#334155', marginBottom: 1 }}>{item.data.subject}</div>
                      <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2 }}>→ {item.data.to}</div>
                      {item.data.status === 'opened' && <span style={{ fontSize: 8, background: '#dbeafe', color: '#1d4ed8', padding: '2px 4px', borderRadius: 3, fontWeight: 500 }}>👁 Ouvert</span>}
                      {item.data.status === 'sent' && <span style={{ fontSize: 8, background: '#dcfce7', color: '#15803d', padding: '2px 4px', borderRadius: 3, fontWeight: 500 }}>✓ Envoyé</span>}
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
