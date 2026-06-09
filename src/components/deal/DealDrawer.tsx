'use client';
import { useState, useEffect, useCallback } from 'react';
import type { Action, Note, Priority } from '@/types';
import { formatDate, isOverdue, formatRelativeDate } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/lib/currentUser';
import PVModal from '@/components/pipeline/PVModal';

const PRIORITIES: Priority[] = ['faible', 'normale', 'élevée', 'urgente'];
const ACTION_TYPES = ['Appeler', 'Email', 'Relancer', 'Démo', 'Autre'];

const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a', fontSize: 13, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 12 };
const btnDef: React.CSSProperties = { padding: '6px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 12 };
const labelStyle: React.CSSProperties = { fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3, fontWeight: 500 };
const sectionTitle: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase', margin: '0 0 10px' };

interface Collaborator { id: string; name: string; color: string; email: string; }
interface User { id: string; name: string; color: string; }
interface EmailTemplate { id: string; name: string; subject: string; body: string; }
interface EmailLog { id: string; to: string; subject: string; body: string; sentAt: string; status: string; openedAt?: string; resendId?: string; template?: { name: string }; }
interface Props { dealId: string; onClose: () => void; onUpdated: () => void; }

function initials(name: string) { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }
function replaceVars(text: string, vars: Record<string, string>) { return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] || ''); }

// Convertit une date ISO en valeur pour un <input type="datetime-local"> (heure locale).
function toLocalInput(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** ISO -> "YYYY-MM-DD" sans décalage de fuseau (on prend la portion date brute). */
function toDateInput(v?: string | null) { return v ? String(v).slice(0, 10) : ''; }
/** "YYYY-MM-DD" -> ISO (midi UTC pour éviter le décalage de jour), ou null. */
function fromDateInput(v: string) { return v ? new Date(v + 'T12:00:00Z').toISOString() : null; }

export default function DealDrawer({ dealId, onClose, onUpdated }: Props) {
  const { user: currentUser } = useCurrentUser();
  const [deal, setDeal] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  // Volet de composition actif : note / action / email
  const [composer, setComposer] = useState<null | 'note' | 'action' | 'email'>(null);

  // Données annexes
  const [users, setUsers] = useState<User[]>([]);
  const [brands, setBrands] = useState<{ id: string; name: string; color: string }[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);

  // Champs éditables du sous-volet (saisie locale, sauvegarde au blur)
  const [fields, setFields] = useState<Record<string, string>>({});

  // Formulaire note
  const [noteText, setNote] = useState('');
  // Formulaire action
  const [actionForm, setAF] = useState<Partial<Action> | null>(null);
  // Formulaire email
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [civilite, setCivilite] = useState('Monsieur');
  const [attachments, setAttachments] = useState<{ name: string; content: string }[]>([]);
  // Formulaire d'ajout manuel d'offre (null = masqué)
  const [offerForm, setOfferForm] = useState<{ jobTitle: string; contractType: string; salary: string; source: string; url: string } | null>(null);
  const [savingOffer, setSavingOffer] = useState(false);

  // Pop-up « Prospection de Valeur » : déclenchée quand on déplace l'affaire vers
  // « Démo prévue » depuis la frise/le sélecteur de pipeline (mêmes effets que sur le board).
  const [pv, setPv] = useState<{ targetColId: string; originColId: string; originPipelineId: string; originColumn: any } | null>(null);

  const fetchDeal = useCallback(async () => {
    const res = await fetch(`/api/deals/${dealId}`);
    if (res.ok) {
      const d = await res.json();
      setDeal(d);
      setFields({
        directeur: d.directeur || '',
        contactCalling: d.contactCalling || '',
        dealEmail: d.dealEmail || '',
        contactCivilite: d.contactCivilite || 'Monsieur',
        contactLastName: d.contactLastName || '',
        dealValue: d.dealValue != null ? String(d.dealValue) : '',
        demoDate: toLocalInput(d.demoDate),
        candidateCallDate: toDateInput(d.candidateCallDate),
      });
      setEmailTo(d.dealEmail || '');
      if (d.contactCivilite) setCivilite(d.contactCivilite);
    }
    setLoading(false);
  }, [dealId]);

  const fetchEmailLogs = useCallback(async () => {
    const res = await fetch(`/api/emails?dealId=${dealId}`);
    if (res.ok) setEmailLogs(await res.json());
  }, [dealId]);

  useEffect(() => { fetchDeal(); fetchEmailLogs(); }, [fetchDeal, fetchEmailLogs]);
  useEffect(() => { fetch('/api/users').then(r => r.json()).then(setUsers).catch(() => {}); }, []);
  useEffect(() => { fetch('/api/brands').then(r => r.json()).then(setBrands).catch(() => {}); }, []);
  useEffect(() => { fetch('/api/columns').then(r => r.json()).then(setColumns).catch(() => {}); }, []);
  useEffect(() => { fetch('/api/pipelines').then(r => r.json()).then(d => setPipelines(d.pipelines || [])).catch(() => {}); }, []);
  useEffect(() => { fetch('/api/email-templates').then(r => r.json()).then(setTemplates).catch(() => {}); }, []);

  // Fermeture au clavier (Échap)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ---- Mutations -----------------------------------------------------------
  const patchDeal = async (data: Record<string, unknown>, msg?: string) => {
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    fetchDeal(); onUpdated(); if (msg) toast(msg);
  };

  const moveToColumn = async (columnId: string, msg = 'Étape mise à jour') => {
    if (columnId === deal?.columnId) return;
    const prevColumnId = deal?.columnId;
    const prevPipelineId = deal?.pipelineId;
    const prevColumn = deal?.column;
    const targetCol = columns.find(c => c.id === columnId);
    // Mise à jour optimiste : la frise (et le pipeline) reflètent le changement immédiatement.
    setDeal((d: any) => ({ ...d, columnId, pipelineId: targetCol?.pipelineId ?? d.pipelineId, column: targetCol || d.column }));

    // Workflow « Prospection de Valeur » : à l'arrivée dans « Démo prévue », on
    // demande confirmation AVANT de persister (Meet + Supabase + duplication ne
    // partent qu'après OUI/NON), comme sur la frise du board.
    if (targetCol?.title === 'Démo prévue') {
      setPv({ targetColId: columnId, originColId: prevColumnId, originPipelineId: prevPipelineId, originColumn: prevColumn });
      return;
    }

    try {
      const res = await fetch(`/api/deals/${dealId}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columnId }) });
      if (!res.ok) throw new Error();
      const data = await res.json().catch(() => null);
      // Persistance réelle : on recharge depuis le serveur. En mode démo (data.demo),
      // on conserve l'état optimiste (rien n'est persisté côté base).
      if (data && !data.demo) fetchDeal();
      onUpdated();
      toast(msg);
    } catch {
      setDeal((d: any) => ({ ...d, columnId: prevColumnId, pipelineId: prevPipelineId }));
      toast('Erreur lors du changement d\'étape', 'error');
    }
  };

  // PV confirmée (OUI/NON) : on persiste le déplacement (déclenche Meet +
  // Supabase) puis on duplique l'affaire vers la cible.
  const handlePvConfirm = async (choice: 'oui' | 'non') => {
    if (!pv) return;
    const moveRes = await fetch(`/api/deals/${dealId}/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId: pv.targetColId, pvChoice: choice }),
    });
    if (!moveRes.ok) { toast('Erreur lors du déplacement', 'error'); throw new Error('move'); }

    const dupRes = await fetch(`/api/deals/${dealId}/duplicate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice }),
    });
    const data = await dupRes.json().catch(() => ({}));
    if (!dupRes.ok || !data.ok) { toast(data.error || 'Erreur lors de la duplication', 'error'); throw new Error('dup'); }

    toast(choice === 'oui'
      ? 'Affaire dupliquée dans Recrutement › Sourcing à faire'
      : 'Affaire dupliquée dans Closing › Demo prevue');
    setPv(null);
    fetchDeal(); onUpdated();
  };

  // PV annulée : rien n'a été persisté → on remet l'affaire dans sa colonne d'origine.
  const handlePvCancel = () => {
    if (pv) {
      setDeal((d: any) => ({ ...d, columnId: pv.originColId, pipelineId: pv.originPipelineId, column: pv.originColumn }));
    }
    setPv(null);
  };

  // Change le pipeline du deal : on le place dans la 1re étape du pipeline cible.
  const changePipeline = (pipelineId: string) => {
    if (pipelineId === deal?.pipelineId) return;
    const firstCol = columns
      .filter(c => c.pipelineId === pipelineId)
      .sort((a, b) => a.position - b.position)[0];
    if (!firstCol) { toast('Ce pipeline n\'a aucune étape', 'error'); return; }
    moveToColumn(firstCol.id, 'Pipeline mis à jour');
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dealId, content: noteText, authorId: currentUser?.id || null, authorName: currentUser?.name || '' }) });
    setNote(''); setComposer(null); fetchDeal(); onUpdated(); toast('Note ajoutée');
  };

  const saveAction = async () => {
    if (!actionForm?.title || !actionForm.dueDate) { toast('Titre et date requis', 'error'); return; }
    const url = actionForm.id ? `/api/actions/${actionForm.id}` : '/api/actions';
    await fetch(url, { method: actionForm.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...actionForm, dealId }) });
    setAF(null); setComposer(null); fetchDeal(); onUpdated(); toast('Action enregistrée');
  };

  const doneAction = async (id: string) => {
    await fetch(`/api/actions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) });
    fetchDeal(); onUpdated();
  };
  const reopenAction = async (id: string) => {
    await fetch(`/api/actions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'todo' }) });
    fetchDeal(); onUpdated();
  };
  const deleteAction = async (id: string) => { await fetch(`/api/actions/${id}`, { method: 'DELETE' }); fetchDeal(); onUpdated(); };

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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId, templateId: selectedTemplate || null, to: emailTo, subject: emailSubject, body: emailBody, attachments }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast('✓ Email envoyé !');
      setEmailSubject(''); setEmailBody(''); setSelectedTemplate(''); setAttachments([]); setComposer(null);
      fetchEmailLogs();
    } catch (e) {
      toast((e as Error).message || 'Erreur envoi', 'error');
    } finally { setSendingEmail(false); }
  };

  const deleteDeal = async () => {
    const name = deal?.store?.name || 'cette affaire';
    if (!window.confirm(`Supprimer ${name} ? Les actions, notes, offres et emails associés seront définitivement supprimés. Cette action est irréversible.`)) return;
    try {
      const res = await fetch(`/api/deals/${dealId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error);
      toast('Affaire supprimée'); onUpdated(); onClose();
    } catch (e) {
      toast((e as Error).message || 'Erreur lors de la suppression', 'error');
    }
  };

  // Ajout manuel d'une offre rattachée à l'affaire.
  const saveOffer = async () => {
    if (!offerForm?.jobTitle.trim()) { toast('Intitulé du poste requis', 'error'); return; }
    if (!deal?.storeId) { toast('Magasin introuvable', 'error'); return; }
    setSavingOffer(true);
    try {
      const res = await fetch('/api/jobOffers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId, storeId: deal.storeId,
          jobTitle: offerForm.jobTitle.trim(),
          title: offerForm.jobTitle.trim(),
          contractType: offerForm.contractType,
          salary: offerForm.salary,
          source: offerForm.source || 'Manuel',
          url: offerForm.url,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setOfferForm(null); fetchDeal(); onUpdated(); toast('Offre ajoutée');
    } catch (e) {
      toast((e as Error).message || 'Erreur lors de l\'ajout de l\'offre', 'error');
    } finally { setSavingOffer(false); }
  };

  const deleteOffer = async (id: string) => {
    if (!window.confirm('Supprimer cette offre ?')) return;
    const res = await fetch(`/api/jobOffers/${id}`, { method: 'DELETE' });
    if (res.ok) { fetchDeal(); onUpdated(); toast('Offre supprimée'); }
    else toast('Erreur lors de la suppression', 'error');
  };

  // ---- Rendu ---------------------------------------------------------------
  if (loading || !deal) return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(15,23,42,.4)', display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: '66vw', maxWidth: 1200, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#94a3b8' }}>Chargement…</span>
      </div>
    </div>
  );

  const store = deal.store;
  const brand = store?.brand;
  const bc = brand?.color || '#6366f1';
  const isWhite = bc === '#ffffff';
  const movedBack = deal.hasNewOfferFromLastImport && !deal.isNewFromLastImport && deal.previousColumnId;

  // Frise : uniquement les étapes du pipeline auquel appartient le deal.
  const sortedCols = columns
    .filter(c => c.pipelineId === deal.pipelineId)
    .sort((a, b) => a.position - b.position);
  const currentIdx = sortedCols.findIndex(c => c.id === deal.columnId);

  const allActions: any[] = deal.actions ?? [];
  const todoActions = allActions
    .filter(a => a.status === 'todo')
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  // Flux d'activité chronologique (le plus récent en premier) :
  // notes + actions terminées + emails envoyés.
  type Feed =
    | { kind: 'note'; date: number; data: Note }
    | { kind: 'action'; date: number; data: any }
    | { kind: 'email'; date: number; data: EmailLog };
  const feed: Feed[] = [
    ...(deal.notes ?? []).map((n: Note) => ({ kind: 'note' as const, date: new Date(n.createdAt).getTime(), data: n })),
    ...allActions.filter(a => a.status === 'done').map(a => ({ kind: 'action' as const, date: new Date(a.completedAt || a.updatedAt || a.dueDate).getTime(), data: a })),
    ...emailLogs.map(l => ({ kind: 'email' as const, date: new Date(l.sentAt).getTime(), data: l })),
  ].sort((a, b) => b.date - a.date);

  const currentAssignedUser = deal.assignedUser as User | null;
  const currentCollab = deal.collaborator as Collaborator | null;

  return (
    <>
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(15,23,42,.4)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '66vw', maxWidth: 1200, minWidth: 720, height: '100%', background: '#f8fafc', borderLeft: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* En-tête */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, background: '#fff', borderTop: `4px solid ${bc}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {brand && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: isWhite ? '#2563eb' : bc, marginBottom: 2 }}>{brand.name}</div>}
              <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>{store?.name}</div>
              {store?.city && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>📍 {store.city}{store.department ? `, ${store.department}` : ''}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {deal.isNewFromLastImport && <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 11, padding: '3px 8px', borderRadius: 4, fontWeight: 600 }}>✦ Nouvelle</span>}
              {!deal.isPresentInLastImport && <span style={{ background: '#fee2e2', color: '#b91c1c', fontSize: 11, padding: '3px 8px', borderRadius: 4, fontWeight: 600 }}>⚠ Absente</span>}
              <select value={deal.priority} onChange={e => patchDeal({ priority: e.target.value })} style={{ ...inp, width: 'auto', padding: '5px 8px', fontSize: 11, background: '#f8fafc' }}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
              <button onClick={onClose} title="Fermer (Échap)" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 24, color: '#94a3b8', padding: 0, lineHeight: 1 }}>×</button>
            </div>
          </div>

          {/* Sélecteur de pipeline */}
          {pipelines.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase' }}>Pipeline</span>
              <select
                value={deal.pipelineId || ''}
                onChange={e => changePipeline(e.target.value)}
                style={{ ...inp, width: 'auto', padding: '4px 8px', fontSize: 12, fontWeight: 600, background: '#f8fafc', color: '#4338ca' }}
              >
                {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          {/* Frise chronologique du pipeline */}
          {sortedCols.length > 0 && (
            <div style={{ display: 'flex', marginTop: 10, gap: 3, overflowX: 'auto', paddingBottom: 2 }}>
              {sortedCols.map((c, i) => {
                const passed = i < currentIdx;
                const current = i === currentIdx;
                const bg = current ? '#4338ca' : passed ? '#6366f1' : '#e2e8f0';
                const color = current || passed ? '#fff' : '#64748b';
                return (
                  <button
                    key={c.id}
                    onClick={() => moveToColumn(c.id)}
                    title={`Déplacer vers « ${c.title} »`}
                    style={{
                      flex: 1, minWidth: 92, position: 'relative', border: 'none', cursor: 'pointer',
                      background: bg, color, fontSize: 10.5, fontWeight: current ? 700 : 500,
                      padding: '8px 10px 8px 18px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      clipPath: 'polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%, 9px 50%)',
                      transition: 'background .15s',
                    }}
                  >
                    {c.title}
                  </button>
                );
              })}
            </div>
          )}

          {movedBack && (
            <div style={{ marginTop: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7, padding: '8px 10px', fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 2 }}>⟳ Retournée en &quot;À appeler&quot;</div>
              <div style={{ color: '#78350f' }}>Nouvelle offre détectée lors du dernier import.</div>
            </div>
          )}
        </div>

        {/* Corps : sous-volet gauche + activité droite */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* ===== Sous-volet gauche : infos du deal ===== */}
          <div style={{ width: 340, flexShrink: 0, borderRight: '1px solid #e2e8f0', overflowY: 'auto', padding: '18px 18px 28px', background: '#fff' }}>

            <div style={sectionTitle}>Magasin</div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', gap: 8, fontSize: 12.5, marginBottom: 6, alignItems: 'center' }}>
                <span style={{ width: 96, flexShrink: 0, color: '#94a3b8' }}>Enseigne</span>
                <select value={store?.brandId || ''} onChange={e => patchDeal({ brandId: e.target.value || null }, 'Enseigne mise à jour')}
                  style={{ ...inp, flex: 1, padding: '4px 8px', fontSize: 12.5 }}>
                  <option value="">— Aucune —</option>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              {[['Magasin', store?.name], ['Ville', store?.city], ['Département', store?.department]].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', gap: 8, fontSize: 12.5, marginBottom: 6 }}>
                  <span style={{ width: 96, flexShrink: 0, color: '#94a3b8' }}>{l}</span>
                  <span style={{ color: v ? '#334155' : '#cbd5e1' }}>{v || '—'}</span>
                </div>
              ))}
            </div>

            <div style={sectionTitle}>Contact</div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ marginBottom: 9 }}>
                <label style={labelStyle}>Civilité</label>
                <select style={inp} value={fields.contactCivilite} onChange={e => { setFields(f => ({ ...f, contactCivilite: e.target.value })); setCivilite(e.target.value); patchDeal({ contactCivilite: e.target.value }); }}>
                  <option>Monsieur</option>
                  <option>Madame</option>
                </select>
              </div>
              {([['Nom de famille', 'contactLastName', 'Dupont'], ['Directeur', 'directeur', 'Prénom Nom'], ['Contact calling', 'contactCalling', 'Prénom Nom'], ['Email', 'dealEmail', 'contact@magasin.fr']] as const).map(([label, key, ph]) => (
                <div key={key} style={{ marginBottom: 9 }}>
                  <label style={labelStyle}>{label}</label>
                  <input
                    style={inp} placeholder={ph} value={fields[key] ?? ''}
                    onChange={e => setFields(f => ({ ...f, [key]: e.target.value }))}
                    onBlur={() => { if ((fields[key] ?? '') !== (deal[key] ?? '')) patchDeal({ [key]: fields[key] ?? '' }); }}
                  />
                </div>
              ))}
            </div>

            <div style={sectionTitle}>Affaire</div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ marginBottom: 9 }}>
                <label style={labelStyle}>Valeur du deal (€)</label>
                <input
                  type="number" style={inp} placeholder="0" value={fields.dealValue ?? ''}
                  onChange={e => setFields(f => ({ ...f, dealValue: e.target.value }))}
                  onBlur={() => {
                    const v = fields.dealValue === '' ? null : Number(fields.dealValue);
                    const cur = deal.dealValue != null ? deal.dealValue : null;
                    if (v !== cur) patchDeal({ dealValue: v });
                  }}
                />
              </div>
              <div style={{ marginBottom: 9 }}>
                <label style={labelStyle}>Date de la démo</label>
                <input
                  type="datetime-local" style={inp} value={fields.demoDate ?? ''}
                  onChange={e => { setFields(f => ({ ...f, demoDate: e.target.value })); patchDeal({ demoDate: e.target.value ? new Date(e.target.value).toISOString() : null }); }}
                />
                {deal.column?.title === 'Démo prévue' && (
                  <p style={{ fontSize: 11, color: '#64748b', marginTop: 5 }}>
                    Une invitation Google Meet est envoyée au contact{deal.dealEmail ? ` (${deal.dealEmail})` : ''} et à bilal@swipelink.fr à l&apos;enregistrement de la date.
                  </p>
                )}
                {deal.googleMeetUrl && (
                  <a href={deal.googleMeetUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 5, fontSize: 12, color: '#4f46e5', textDecoration: 'underline' }}>
                    🔗 Ouvrir le lien Google Meet
                  </a>
                )}
              </div>
              <div style={{ marginBottom: 9 }}>
                <label style={labelStyle}>Date d&apos;appel des candidats</label>
                <input
                  type="date" style={inp} value={fields.candidateCallDate ?? ''}
                  onChange={e => { setFields(f => ({ ...f, candidateCallDate: e.target.value })); patchDeal({ candidateCallDate: fromDateInput(e.target.value) }); }}
                />
              </div>
              <div>
                <label style={labelStyle}>Assigné à</label>
                <select
                  style={inp}
                  value={currentAssignedUser?.id || (currentCollab ? `collab:${currentCollab.id}` : '')}
                  onChange={e => {
                    const v = e.target.value;
                    // Valeur historique (collaborateur déjà assigné) : aucune action.
                    if (v.startsWith('collab:')) return;
                    // Toute (ré)assignation passe désormais par la liste des utilisateurs ;
                    // on retire au passage l'éventuel collaborateur hérité.
                    patchDeal({ assignedUserId: v || null, collaboratorId: null }, 'Assignation mise à jour');
                  }}
                >
                  <option value="">— Personne —</option>
                  {!currentAssignedUser && currentCollab && (
                    <option value={`collab:${currentCollab.id}`}>{currentCollab.name}</option>
                  )}
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>

            <div style={sectionTitle}>Offres</div>
            <div style={{ marginBottom: 18 }}>
              {(deal.jobOffers ?? []).length === 0 && <p style={{ color: '#cbd5e1', fontSize: 12.5 }}>Aucune offre.</p>}
              {(deal.jobOffers ?? []).map((o: any, i: number) => (
                <div key={o.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 11px', marginBottom: 7, background: i === 0 ? '#f5f3ff' : '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a', flex: 1, minWidth: 0 }}>{o.jobTitle || o.title || 'Offre'}</span>
                    {i === 0 && <span style={{ fontSize: 9.5, fontWeight: 700, background: '#ede9fe', color: '#6d28d9', padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>DERNIÈRE</span>}
                    <button onClick={() => deleteOffer(o.id)} title="Supprimer l'offre" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: 12, padding: 0, flexShrink: 0 }}>🗑</button>
                  </div>
                  {(o.contractType || o.salary) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, color: '#64748b', marginBottom: 4 }}>
                      {o.contractType && <span style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 3 }}>{o.contractType}</span>}
                      {o.salary && <span style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 3 }}>{o.salary}</span>}
                    </div>
                  )}
                  {(o.publishedAt || o.source) && (
                    <div style={{ fontSize: 10.5, color: '#94a3b8' }}>
                      {o.publishedAt && <span>Publiée le {o.publishedAt}</span>}
                      {o.source && <span>{o.publishedAt ? ' · ' : ''}{o.source}</span>}
                    </div>
                  )}
                  {o.url && <a href={o.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#4f46e5', textDecoration: 'underline', display: 'inline-block', marginTop: 4 }}>🔗 Voir l&apos;offre</a>}
                </div>
              ))}

              {offerForm ? (
                <div style={{ border: '1px solid #c7d2fe', borderRadius: 8, padding: 11, background: '#f8fafc' }}>
                  <div style={{ marginBottom: 8 }}>
                    <label style={labelStyle}>Intitulé du poste *</label>
                    <input style={inp} placeholder="Ex. Boucher" value={offerForm.jobTitle} autoFocus
                      onChange={e => setOfferForm(f => f && ({ ...f, jobTitle: e.target.value }))} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div>
                      <label style={labelStyle}>Type de contrat</label>
                      <input style={inp} placeholder="CDI…" value={offerForm.contractType}
                        onChange={e => setOfferForm(f => f && ({ ...f, contractType: e.target.value }))} />
                    </div>
                    <div>
                      <label style={labelStyle}>Salaire</label>
                      <input style={inp} placeholder="—" value={offerForm.salary}
                        onChange={e => setOfferForm(f => f && ({ ...f, salary: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={labelStyle}>Source</label>
                    <input style={inp} placeholder="Manuel" value={offerForm.source}
                      onChange={e => setOfferForm(f => f && ({ ...f, source: e.target.value }))} />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={labelStyle}>Lien de l&apos;offre</label>
                    <input style={inp} placeholder="https://…" value={offerForm.url}
                      onChange={e => setOfferForm(f => f && ({ ...f, url: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={{ ...btnPri, opacity: savingOffer ? .7 : 1, cursor: savingOffer ? 'not-allowed' : 'pointer' }} onClick={saveOffer} disabled={savingOffer}>{savingOffer ? '⟳ Ajout…' : 'Ajouter'}</button>
                    <button style={btnDef} onClick={() => setOfferForm(null)}>Annuler</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setOfferForm({ jobTitle: '', contractType: '', salary: '', source: '', url: '' })}
                  style={{ ...btnDef, width: '100%', background: '#fff', padding: '8px 12px' }}>+ Ajouter une offre</button>
              )}
            </div>

            <div style={sectionTitle}>CRM</div>
            <div style={{ marginBottom: 22 }}>
              {[['Créé le', formatDate(deal.createdAt)], ['Dernier import', formatDate(deal.lastImportAt)]].map(([l, v]) => v && v !== '—' && (
                <div key={l} style={{ display: 'flex', gap: 8, fontSize: 12.5, marginBottom: 6 }}>
                  <span style={{ width: 96, flexShrink: 0, color: '#94a3b8' }}>{l}</span>
                  <span style={{ color: '#334155' }}>{v}</span>
                </div>
              ))}
            </div>

            <button onClick={deleteDeal} style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
              🗑 Supprimer l&apos;affaire
            </button>
          </div>

          {/* ===== Zone d'activité droite ===== */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px' }}>

            {/* Trois boutons d'action */}
            <div style={{ display: 'flex', gap: 10, marginBottom: composer ? 14 : 22 }}>
              <button onClick={() => setComposer(composer === 'note' ? null : 'note')} style={composer === 'note' ? { ...btnPri, padding: '10px 16px', fontSize: 13 } : { ...btnDef, padding: '10px 16px', fontSize: 13, background: '#fff' }}>📝 Ajouter une note</button>
              <button onClick={() => { setComposer(composer === 'action' ? null : 'action'); if (composer !== 'action') setAF({ title: '', type: 'Appeler', dueDate: new Date().toISOString().slice(0, 10), priority: 'normale', note: '', dueTime: '', assignedUserId: currentUser?.id || '' } as any); }} style={composer === 'action' ? { ...btnPri, padding: '10px 16px', fontSize: 13 } : { ...btnDef, padding: '10px 16px', fontSize: 13, background: '#fff' }}>✅ Ajouter une action</button>
              <button onClick={() => setComposer(composer === 'email' ? null : 'email')} style={composer === 'email' ? { ...btnPri, padding: '10px 16px', fontSize: 13 } : { ...btnDef, padding: '10px 16px', fontSize: 13, background: '#fff' }}>📧 Envoyer un mail</button>
            </div>

            {/* Composer : Note */}
            {composer === 'note' && (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 22 }}>
                <textarea style={{ ...inp, height: 80, resize: 'vertical', marginBottom: 10 }} placeholder="Saisir une note…" value={noteText} onChange={e => setNote(e.target.value)} autoFocus />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btnPri} onClick={addNote}>Ajouter la note</button>
                  <button style={btnDef} onClick={() => { setComposer(null); setNote(''); }}>Annuler</button>
                </div>
              </div>
            )}

            {/* Composer : Action */}
            {composer === 'action' && actionForm && (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 22 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <input style={{ ...inp, gridColumn: '1/-1' }} placeholder="Titre *" value={actionForm.title || ''} onChange={e => setAF(f => ({ ...f, title: e.target.value }))} autoFocus />
                  <select style={inp} value={actionForm.type || 'Appeler'} onChange={e => setAF(f => ({ ...f, type: e.target.value as Action['type'] }))}>{ACTION_TYPES.map(t => <option key={t}>{t}</option>)}</select>
                  <select style={inp} value={actionForm.priority || 'normale'} onChange={e => setAF(f => ({ ...f, priority: e.target.value as Priority }))}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select>
                  <input type="date" style={inp} value={typeof actionForm.dueDate === 'string' ? actionForm.dueDate.slice(0, 10) : ''} onChange={e => setAF(f => ({ ...f, dueDate: e.target.value }))} />
                  <input type="time" style={inp} value={(actionForm as any).dueTime || ''} onChange={e => setAF(f => ({ ...f, dueTime: e.target.value } as any))} />
                  <select style={{ ...inp, gridColumn: '1/-1' }} value={(actionForm as any).assignedUserId || ''} onChange={e => setAF(f => ({ ...f, assignedUserId: e.target.value } as any))}>
                    <option value="">— Assignée à (utilisateur) —</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <textarea style={{ ...inp, height: 50, resize: 'none', gridColumn: '1/-1' }} placeholder="Note…" value={actionForm.note || ''} onChange={e => setAF(f => ({ ...f, note: e.target.value }))} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btnPri} onClick={saveAction}>Enregistrer</button>
                  <button style={btnDef} onClick={() => { setComposer(null); setAF(null); }}>Annuler</button>
                </div>
              </div>
            )}

            {/* Composer : Email */}
            {composer === 'email' && (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 22 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={labelStyle}>Template</label>
                    <select style={inp} value={selectedTemplate} onChange={e => applyTemplate(e.target.value)}>
                      <option value="">— Choisir un template —</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Civilité</label>
                    <select style={inp} value={civilite} onChange={e => { setCivilite(e.target.value); if (selectedTemplate) applyTemplate(selectedTemplate); }}>
                      <option>Monsieur</option>
                      <option>Madame</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={labelStyle}>Destinataire *</label>
                  <input style={inp} type="email" placeholder="contact@magasin.fr" value={emailTo} onChange={e => setEmailTo(e.target.value)} />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={labelStyle}>Sujet *</label>
                  <input style={inp} placeholder="Objet de l'email" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={labelStyle}>Message *</label>
                  <textarea style={{ ...inp, height: 160, resize: 'vertical', fontSize: 12 }} placeholder="Corps de l'email…" value={emailBody} onChange={e => setEmailBody(e.target.value)} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Pièce jointe PDF</label>
                  <input type="file" accept=".pdf" multiple onChange={async e => {
                    const files = Array.from(e.target.files || []);
                    const converted = await Promise.all(files.map(f => new Promise<{ name: string; content: string }>((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve({ name: f.name, content: (reader.result as string).split(',')[1] });
                      reader.onerror = reject;
                      reader.readAsDataURL(f);
                    })));
                    setAttachments(converted);
                  }} style={{ fontSize: 12, color: '#334155' }} />
                  {attachments.length > 0 && (
                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {attachments.map((a, i) => (
                        <span key={i} style={{ fontSize: 11, background: '#eef2ff', color: '#4338ca', padding: '2px 8px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          📎 {a.name}
                          <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 12, padding: 0 }}>×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={sendEmail} disabled={sendingEmail} style={{ ...btnPri, opacity: sendingEmail ? .7 : 1, cursor: sendingEmail ? 'not-allowed' : 'pointer' }}>{sendingEmail ? '⟳ Envoi…' : '📧 Envoyer'}</button>
                  <button style={btnDef} onClick={() => setComposer(null)}>Annuler</button>
                </div>
              </div>
            )}

            {/* Actions programmées (à venir, aujourd'hui, en retard) */}
            <div style={{ marginBottom: 26 }}>
              <div style={{ ...sectionTitle, marginBottom: 12 }}>Actions programmées {todoActions.length > 0 && `(${todoActions.length})`}</div>
              {todoActions.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>Aucune action programmée.</p>}
              {todoActions.map(a => {
                const late = isOverdue(a.dueDate) && new Date(a.dueDate).toDateString() !== new Date().toDateString();
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 13px', borderRadius: 9, border: `1px solid ${late ? '#fecaca' : '#e2e8f0'}`, background: late ? '#fef2f2' : '#fff', marginBottom: 7 }}>
                    <button onClick={() => doneAction(a.id)} title="Marquer comme terminée" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #cbd5e1', background: 'transparent', cursor: 'pointer', flexShrink: 0, marginTop: 1 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{a.title}</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 3, fontSize: 11.5, color: late ? '#dc2626' : '#64748b', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ background: '#eef2ff', color: '#4338ca', padding: '1px 6px', borderRadius: 3 }}>{a.type}</span>
                        <span style={{ fontWeight: late ? 700 : 400 }}>{formatRelativeDate(a.dueDate)} · {formatDate(a.dueDate)}</span>
                        {a.dueTime && <span>à {a.dueTime}</span>}
                        {a.assignedUser && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 16, height: 16, borderRadius: '50%', background: a.assignedUser.color, color: '#fff', fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{initials(a.assignedUser.name)}</span>
                            {a.assignedUser.name}
                          </span>
                        )}
                      </div>
                      {a.note && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{a.note}</div>}
                    </div>
                    <button onClick={() => { setComposer('action'); setAF({ ...a, dueDate: typeof a.dueDate === 'string' ? a.dueDate.slice(0, 10) : '' }); }} style={{ ...btnDef, padding: '3px 7px', fontSize: 11 }}>✎</button>
                    <button onClick={() => deleteAction(a.id)} style={{ ...btnDef, padding: '3px 7px', fontSize: 11 }}>🗑</button>
                  </div>
                );
              })}
            </div>

            {/* Historique chronologique : notes, actions terminées, emails */}
            <div>
              <div style={{ ...sectionTitle, marginBottom: 12 }}>Historique</div>
              {feed.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>Aucune activité pour le moment.</p>}
              <div style={{ position: 'relative' }}>
                {feed.map((item, idx) => (
                  <div key={`${item.kind}-${idx}`} style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                    {/* Pastille + fil */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 28 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, background: item.kind === 'note' ? '#fef9c3' : item.kind === 'action' ? '#dcfce7' : '#dbeafe' }}>
                        {item.kind === 'note' ? '📝' : item.kind === 'action' ? '✅' : '📧'}
                      </div>
                      {idx < feed.length - 1 && <div style={{ flex: 1, width: 2, background: '#e2e8f0', marginTop: 4 }} />}
                    </div>

                    <div style={{ flex: 1, minWidth: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9, padding: '11px 13px' }}>
                      {item.kind === 'note' && <NoteItem note={item.data as Note} />}
                      {item.kind === 'action' && <DoneActionItem action={item.data} onReopen={() => reopenAction(item.data.id)} onDelete={() => deleteAction(item.data.id)} />}
                      {item.kind === 'email' && <EmailLogItem log={item.data as EmailLog} />}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
    {pv && <PVModal onConfirm={handlePvConfirm} onCancel={handlePvCancel} />}
    </>
  );
}

function NoteItem({ note }: { note: Note }) {
  return (
    <>
      <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginBottom: 6, color: '#0f172a' }}>{note.content}</p>
      <p style={{ fontSize: 10.5, color: '#94a3b8' }}>
        {(note as any).authorName ? <span style={{ fontWeight: 600, color: '#64748b' }}>{(note as any).authorName}</span> : <span style={{ fontStyle: 'italic' }}>Anonyme</span>}
        {' · '}{formatDate(note.createdAt)}
      </p>
    </>
  );
}

function DoneActionItem({ action, onReopen, onDelete }: { action: any; onReopen: () => void; onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <button onClick={onReopen} title="Rouvrir l'action" style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #16a34a', background: '#16a34a', color: '#fff', fontSize: 10, cursor: 'pointer', flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', textDecoration: 'line-through' }}>{action.title}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 3, fontSize: 11, color: '#94a3b8', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ background: '#f1f5f9', color: '#64748b', padding: '1px 6px', borderRadius: 3 }}>{action.type}</span>
          <span>Terminée le {formatDate(action.completedAt || action.updatedAt || action.dueDate)}</span>
          {action.assignedUser && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 15, height: 15, borderRadius: '50%', background: action.assignedUser.color, color: '#fff', fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{initials(action.assignedUser.name)}</span>
              {action.assignedUser.name}
            </span>
          )}
        </div>
        {action.note && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{action.note}</div>}
      </div>
      <button onClick={onDelete} style={{ ...btnDef, padding: '2px 6px', fontSize: 11 }}>🗑</button>
    </div>
  );
}

function EmailLogItem({ log }: { log: EmailLog }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#0f172a' }}>{log.subject}</span>
        {log.status === 'opened'
          ? <span style={{ fontSize: 10, background: '#dbeafe', color: '#1d4ed8', padding: '2px 6px', borderRadius: 3, flexShrink: 0, fontWeight: 600 }}>👁 Ouvert</span>
          : <span style={{ fontSize: 10, background: '#dcfce7', color: '#15803d', padding: '2px 6px', borderRadius: 3, flexShrink: 0, fontWeight: 600 }}>✓ Envoyé</span>
        }
      </div>
      <div style={{ fontSize: 11, color: '#64748b' }}>→ {log.to}</div>
      {log.template && <div style={{ fontSize: 10, color: '#94a3b8' }}>Template : {log.template.name}</div>}
      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{formatDate(log.sentAt)}{log.openedAt && <span style={{ color: '#1d4ed8' }}> · 👁 Ouvert le {formatDate(log.openedAt)}</span>}</div>
      <button onClick={() => setExpanded(!expanded)} style={{ fontSize: 11, color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', textDecoration: 'underline' }}>
        {expanded ? 'Masquer' : 'Voir le contenu'}
      </button>
      {expanded && (
        <div style={{ marginTop: 6, padding: '10px 12px', background: '#f8fafc', borderRadius: 6, fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', borderLeft: '3px solid #6366f1' }}>
          {log.body}
        </div>
      )}
    </div>
  );
}
