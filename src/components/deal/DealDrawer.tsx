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
  const [contacts, setContacts] = useState({ directeur: '', contactCalling: '', dealEmail: '', dealValue: '', demoDate: '' });
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
      setContacts({ directeur: d.directeur || '', contactCalling: d.contactCalling || '', dealEmail: d.dealEmail || '', dealValue: d.dealValue ? d.dealValue.toString() : '', demoDate: d.demoDate ? d.demoDate.split('T')[0] : '' });
      setEmailTo(d.dealEmail || '');
    }
    setLoading(false);
  }, [dealId]);

  const fetchEmailLogs = useCallback(async () => {
    const res = await fetch(`/api/emails?dealId=${dealId}`);
    if (res.ok) setEmailLogs(await res.json());
  }, [dealId]);

  useEffect(() => { fetchDeal(); fetchEmailLogs(); }, [fetchDeal]);
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

  const saveContacts = async () => {
    const payload = { 
      directeur: contacts.directeur,
      contactCalling: contacts.contactCalling,
      dealEmail: contacts.dealEmail,
      dealValue: contacts.dealValue ? parseFloat(contacts.dealValue) : null,
      demoDate: contacts.demoDate ? new Date(contacts.demoDate).toISOString() : null
    };
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setEditContacts(false); fetchDeal(); onUpdated(); toast('Contacts mis à jour');
  };

  const assignCollaborator = async (collaboratorId: string | null) => {
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collaboratorId }) });
    fetchDeal(); onUpdated(); toast('Assignation mise à jour');
  };

  const setPriority = async (priority: Priority) => {
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority }) });
    fetchDeal(); onUpdated();
  };

  if (loading || !deal) return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,.3)', display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: 'calc(100vw * 2 / 3)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
  const currentCollab = deal.collaborator as Collaborator | null;

  const timeline = [
    ...dNotes.map((n: Note) => ({ type: 'note', data: n, date: new Date(n.createdAt) })),
    ...emailLogs.map((e: EmailLog) => ({ type: 'email', data: e, date: new Date(e.sentAt) })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,.3)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'calc(100vw * 2 / 3)', height: '100%', background: '#fff', borderLeft: '1px solid #e2e8f0', display: 'flex', overflow: 'hidden' }}>

        {/* LEFT: INFO (1/3) */}
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
                  {[['Directeur', 'directeur'], ['Contact calling', 'contactCalling'], ['Email', 'dealEmail']].map(([label, key]) => (
                    <div key={key} style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4, fontWeight: 600 }}>{label}</label>
                      <input style={{ ...inp, padding: '8px 10px', fontSize: 12 }} placeholder="" value={(contacts as any)[key]} onChange={e => setContacts(c => ({ ...c, [key]: e.target.value }))} />
                    </div>
                  ))}
                  <button style={{ ...btnPri, width: '100%', fontSize: 11, padding: '7px 10px' }} onClick={saveContacts}>Enregistrer</button>
                </div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 13, background: '#f8fafc' }}>
                  {[['Directeur', deal.directeur], ['Contact calling', deal.contactCalling], ['Email', deal.dealEmail]].map(([l, v]) => (
                    <div key={l} style={{ fontSize: 12, marginBottom: 7 }}>
                      <div style={{ color: '#94a3b8', fontWeight: 600, marginBottom: 2 }}>{l}</div>
                      <div style={{ color: v ? '#334155' : '#cbd5e1', fontSize: 12 }}>{v || '—'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* COMMERCIAL */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase', marginBottom: 10 }}>💰 COMMERCIAL</div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 13, background: '#f8fafc' }}>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 4 }}>Valeur</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: deal.dealValue ? '#059669' : '#cbd5e1' }}>
                    {deal.dealValue ? `€${deal.dealValue.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 4 }}>Date DEMO</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: deal.demoDate ? '#3b82f6' : '#cbd5e1' }}>
                    {deal.demoDate ? formatDate(deal.demoDate) : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* OFFRE */}
            {dOffers.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase', marginBottom: 10 }}>💼 OFFRE</div>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 13, background: '#f8fafc' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>{dOffers[0].jobTitle || dOffers[0].title}</div>
                  {dOffers[0].contractType && <div style={{ fontSize: 12, color: '#64748b', marginBottom: 3 }}>📄 {dOffers[0].contractType}</div>}
                  {dOffers[0].salary && <div style={{ fontSize: 12, color: '#64748b' }}>💵 {dOffers[0].salary}</div>}
                </div>
              </div>
            )}

            {/* ASSIGNÉ */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase', marginBottom: 10 }}>👥 ASSIGNÉ À</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button onClick={() => assignCollaborator(null)} style={{ padding: '6px 10px', borderRadius: 18, fontSize: 11, cursor: 'pointer', border: '1px solid', background: !currentCollab ? '#eef2ff' : '#f1f5f9', color: !currentCollab ? '#4338ca' : '#64748b', borderColor: !currentCollab ? '#6366f1' : '#e2e8f0', fontWeight: !currentCollab ? 600 : 400 }}>Non assigné</button>
                {collaborators.map(c => (
                  <button key={c.id} onClick={() => assignCollaborator(c.id)} style={{ padding: '6px 10px', borderRadius: 18, fontSize: 11, cursor: 'pointer', border: '1px solid', display: 'flex', alignItems: 'center', gap: 4, background: currentCollab?.id === c.id ? c.color + '22' : '#f1f5f9', color: currentCollab?.id === c.id ? c.color : '#64748b', borderColor: currentCollab?.id === c.id ? c.color : '#e2e8f0', fontWeight: currentCollab?.id === c.id ? 600 : 400 }}>
                    <span style={{ width: 16, height: 16, borderRadius: '50%', background: c.color, color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(c.name)}</span>
                    <span style={{ fontSize: 11 }}>{c.name}</span>
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* RIGHT: FEED (2/3) */}
        <div style={{ flex: 2, display: 'flex', flexDirection: 'column' }}>
          {/* HEADER */}
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, borderTop: `4px solid ${bc}` }}>
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
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
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
