'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Action, Note, Priority } from '@/types';
import { formatDate, isOverdue, formatRelativeDate, addMonths, formatCurrency } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/lib/currentUser';
import RichTextEditor from '@/components/ui/RichTextEditor';

/** Détecte si une chaîne contient du HTML (balises ou entités, ex. &nbsp;). */
function isHtml(s: string) { return /<[a-z][\s\S]*>|&[a-z#0-9]+;/i.test(s || ''); }


const PRIORITIES: Priority[] = ['faible', 'normale', 'élevée', 'urgente'];
const ACTION_TYPES = ['Appeler', 'Email', 'Relancer', 'Démo', 'Autre'];

const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a', fontSize: 13, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 12 };
const btnDef: React.CSSProperties = { padding: '6px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 12 };
const labelStyle: React.CSSProperties = { fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3, fontWeight: 500 };
const sectionTitle: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase', margin: '0 0 10px' };

/** Sélecteur segmenté à deux états (ou plus) — utilisé pour le type de paiement
 *  (Virement / Stripe) et la cadence (Comptant / Mensuel) dans l'onglet Abonnement. */
function SegToggle({ value, options, onChange }: {
  value: string;
  options: { value: string; label: string; color: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 9, padding: 3, gap: 3 }}>
      {options.map(o => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              border: 'none', cursor: 'pointer', padding: '6px 16px', borderRadius: 7,
              fontSize: 12.5, fontWeight: 700, transition: 'all .12s',
              background: active ? o.color : 'transparent', color: active ? '#fff' : '#64748b',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

interface Collaborator { id: string; name: string; color: string; email: string; }
interface User { id: string; name: string; color: string; }
interface EmailTemplate { id: string; name: string; subject: string; body: string; }
interface EmailLog { id: string; to: string; subject: string; body: string; sentAt: string; status: string; openedAt?: string; resendId?: string; template?: { name: string }; }
interface Props { dealId: string; onClose: () => void; onUpdated: () => void; onNavigate?: (dealId: string) => void; }

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



/** Carte d'édition d'un abonnement (onglet « Abonnement »). Gère son état local
 *  pour une saisie fluide et persiste via onPatch. */
function SubscriptionCard({ sub, index, subscriptionTypes, onPatch, onDelete }: {
  sub: any;
  index: number;
  subscriptionTypes: { id: string; name: string }[];
  onPatch: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [value, setValue] = useState(sub.value != null ? String(sub.value) : '');
  const [closing, setClosing] = useState(toDateInput(sub.closingDate));
  const [durYears, setDurYears] = useState(Math.floor((sub.subscriptionMonths ?? 12) / 12));
  const [durMonths, setDurMonths] = useState((sub.subscriptionMonths ?? 12) % 12);

  // Resynchronise les champs locaux quand on change d'abonnement (id différent).
  useEffect(() => {
    setValue(sub.value != null ? String(sub.value) : '');
    setClosing(toDateInput(sub.closingDate));
    setDurYears(Math.floor((sub.subscriptionMonths ?? 12) / 12));
    setDurMonths((sub.subscriptionMonths ?? 12) % 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub.id]);

  const totalMonths = durYears * 12 + durMonths;
  const endDate = closing ? addMonths(new Date(closing + 'T12:00:00Z'), totalMonths) : null;
  const isStripe = sub.paymentMode !== 'virement';
  const applyDuration = (y: number, mo: number) => {
    const yy = Math.max(0, Math.floor(y || 0));
    const mm = Math.max(0, Math.floor(mo || 0));
    setDurYears(yy); setDurMonths(mm);
    onPatch(sub.id, { subscriptionMonths: yy * 12 + mm });
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '.5px' }}>Abonnement {index + 1}</div>
        <button type="button" onClick={() => onDelete(sub.id)} title="Supprimer cet abonnement"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 12, fontWeight: 600 }}>
          Supprimer
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={labelStyle}>Type d&apos;abonnement</label>
          <select style={inp} value={sub.subscriptionType || ''} onChange={e => onPatch(sub.id, { subscriptionType: e.target.value })}>
            <option value="">— Choisir —</option>
            {subscriptionTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            {sub.subscriptionType && !subscriptionTypes.some(t => t.name === sub.subscriptionType) && (
              <option value={sub.subscriptionType}>{sub.subscriptionType}</option>
            )}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Valeur (€)</label>
          <input
            type="number" style={inp} placeholder="0" value={value}
            onChange={e => setValue(e.target.value)}
            onBlur={() => { const v = value === '' ? null : Number(value); if (v !== (sub.value ?? null)) onPatch(sub.id, { value: v }); }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 14 }}>
        <div>
          <label style={labelStyle}>Type de paiement</label>
          <SegToggle
            value={isStripe ? 'stripe' : 'virement'}
            options={[{ value: 'stripe', label: 'Stripe', color: '#8b5cf6' }, { value: 'virement', label: 'Virement', color: '#64748b' }]}
            onChange={v => onPatch(sub.id, { paymentMode: v })}
          />
        </div>
        <div>
          <label style={labelStyle}>Paiement</label>
          <SegToggle
            value={sub.paymentTiming === 'mensuel' ? 'mensuel' : 'comptant'}
            options={[{ value: 'comptant', label: 'Comptant', color: '#4f46e5' }, { value: 'mensuel', label: 'Mensuel', color: '#0ea5e9' }]}
            onChange={v => onPatch(sub.id, { paymentTiming: v })}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        <div>
          <label style={labelStyle}>Date de closing</label>
          <input
            type="date" style={inp} value={closing}
            onChange={e => setClosing(e.target.value)}
            onBlur={() => { if (closing !== toDateInput(sub.closingDate)) onPatch(sub.id, { closingDate: fromDateInput(closing) }); }}
          />
        </div>
        <div>
          <label style={labelStyle}>Durée de l&apos;abonnement</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <input type="number" min={0} style={{ ...inp, width: 60 }} value={durYears} onChange={e => applyDuration(Number(e.target.value), durMonths)} />
            <span style={{ fontSize: 12, color: '#475569' }}>an(s)</span>
            <input type="number" min={0} style={{ ...inp, width: 60 }} value={durMonths} onChange={e => applyDuration(durYears, Number(e.target.value))} />
            <span style={{ fontSize: 12, color: '#475569' }}>mois</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={labelStyle}>Date de fin (calculée automatiquement)</label>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8,
          background: endDate ? '#ecfdf5' : '#f8fafc', border: `1px solid ${endDate ? '#a7f3d0' : '#e2e8f0'}`,
          fontSize: 13.5, fontWeight: 700, color: endDate ? '#047857' : '#94a3b8',
        }}>
          🗓 {endDate ? formatDate(endDate) : '—'}
        </div>
      </div>
    </div>
  );
}

export default function DealDrawer({ dealId, onClose, onUpdated, onNavigate }: Props) {
  const { user: currentUser } = useCurrentUser();
  const [deal, setDeal] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  // Onglet actif de la zone de droite : activité (par défaut) ou recrutement.
  const [activeTab, setActiveTab] = useState<'activite' | 'abonnement' | 'recrutement' | 'proches'>('activite');

  // Volet de composition actif : note / action / email
  const [composer, setComposer] = useState<null | 'note' | 'action' | 'email'>(null);

  // Données annexes
  const [users, setUsers] = useState<User[]>([]);
  const [brands, setBrands] = useState<{ id: string; name: string; color: string }[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [subscriptionTypes, setSubscriptionTypes] = useState<{ id: string; name: string }[]>([]);
  // Abonnements de l'affaire (1 ou 2). Source de vérité de l'onglet « Abonnement ».
  const [subs, setSubs] = useState<any[]>([]);
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

  // Regroupement : recherche d'un deal parent à rattacher.
  const [showParentSearch, setShowParentSearch] = useState(false);
  const [parentQuery, setParentQuery] = useState('');
  const [parentResults, setParentResults] = useState<any[]>([]);
  const [searchingParent, setSearchingParent] = useState(false);

  const fetchDeal = useCallback(async () => {
    const res = await fetch(`/api/deals/${dealId}`);
    if (res.ok) {
      const d = await res.json();
      setDeal(d);
      setFields({
        storeName: d.store?.name || '',
        directeur: d.directeur || '',
        contactCalling: d.contactCalling || '',
        dealEmail: d.dealEmail || '',
        contactCivilite: d.contactCivilite || 'Monsieur',
        contactLastName: d.contactLastName || '',
        dealValue: d.dealValue != null ? String(d.dealValue) : '',
        demoDate: toLocalInput(d.demoDate),
        candidateCallDate: toDateInput(d.candidateCallDate),
        closingDate: toDateInput(d.closingDate),
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
  useEffect(() => { fetch('/api/subscription-types').then(r => r.json()).then(setSubscriptionTypes).catch(() => {}); }, []);
  const fetchSubs = useCallback(() => {
    fetch(`/api/deals/${dealId}/subscriptions`).then(r => r.json()).then(d => setSubs(Array.isArray(d) ? d : [])).catch(() => {});
  }, [dealId]);
  useEffect(() => { fetchSubs(); }, [fetchSubs]);

  // Fermeture au clavier (Échap)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Recherche débouncée d'un deal parent à rattacher (réutilise /api/deals/search).
  // On exclut l'affaire courante et les affaires déjà rattachées (sous-deals).
  useEffect(() => {
    if (!showParentSearch) return;
    const term = parentQuery.trim();
    if (term.length < 2) { setParentResults([]); return; }
    setSearchingParent(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/deals/search?q=${encodeURIComponent(term)}`);
        if (res.ok) {
          const list = await res.json();
          setParentResults((Array.isArray(list) ? list : []).filter((r: any) => r.id !== dealId && !r.parentDealId));
        }
      } catch { /* ignore */ } finally { setSearchingParent(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [parentQuery, showParentSearch, dealId]);

  // ---- Mutations -----------------------------------------------------------
  const patchDeal = async (data: Record<string, unknown>, msg?: string) => {
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    fetchDeal(); onUpdated(); if (msg) toast(msg);
  };

  // ---- Abonnements ---------------------------------------------------------
  const patchSub = async (id: string, data: Record<string, unknown>) => {
    const res = await fetch(`/api/subscriptions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.ok) { const updated = await res.json(); setSubs(prev => prev.map(s => s.id === id ? updated : s)); onUpdated(); }
  };
  const addSub = async () => {
    const res = await fetch(`/api/deals/${dealId}/subscriptions`, { method: 'POST' });
    if (res.ok) { fetchSubs(); onUpdated(); toast('Abonnement ajouté'); }
    else { const d = await res.json().catch(() => ({})); toast(d.error || 'Erreur', 'error'); }
  };
  const deleteSub = async (id: string) => {
    if (!confirm('Supprimer cet abonnement ?')) return;
    const res = await fetch(`/api/subscriptions/${id}`, { method: 'DELETE' });
    if (res.ok) { fetchSubs(); onUpdated(); toast('Abonnement supprimé'); }
  };

  const moveToColumn = async (columnId: string, msg = 'Étape mise à jour') => {
    if (columnId === deal?.columnId) return;
    const prevColumnId = deal?.columnId;
    const prevPipelineId = deal?.pipelineId;
    const targetCol = columns.find(c => c.id === columnId);
    // Mise à jour optimiste : la frise (et le pipeline) reflètent le changement immédiatement.
    setDeal((d: any) => ({ ...d, columnId, pipelineId: targetCol?.pipelineId ?? d.pipelineId, column: targetCol || d.column }));
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

  const editNote = async (id: string, content: string) => {
    await fetch(`/api/notes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
    fetchDeal(); onUpdated(); toast('Note modifiée');
  };
  const deleteNote = async (id: string) => {
    if (!window.confirm('Supprimer cette note ?')) return;
    await fetch(`/api/notes/${id}`, { method: 'DELETE' });
    fetchDeal(); onUpdated(); toast('Note supprimée');
  };

  const getVars = (d: any) => ({
    civilite,
    nom_famille: d?.contactLastName || '',
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

  // ---- Regroupement d'affaires --------------------------------------------
  // Rattache l'affaire courante à un deal parent (elle devient un sous-deal et
  // disparaît du pipeline). PATCH parentDealId → la validation serveur applique
  // la règle du niveau unique.
  const attachToParent = async (parentId: string) => {
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentDealId: parentId }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setShowParentSearch(false); setParentQuery(''); setParentResults([]);
      fetchDeal(); onUpdated(); toast('Affaire rattachée');
    } catch (e) {
      toast((e as Error).message || 'Erreur lors du rattachement', 'error');
    }
  };

  // Détache l'affaire de son parent : elle réapparaît dans le pipeline.
  const detachFromParent = async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentDealId: null }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      fetchDeal(); onUpdated(); toast('Affaire détachée');
    } catch (e) {
      toast((e as Error).message || 'Erreur lors du détachement', 'error');
    }
  };

  // Détache un sous-deal donné (depuis la fiche du parent).
  const detachChild = async (childId: string) => {
    try {
      const res = await fetch(`/api/deals/${childId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentDealId: null }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      fetchDeal(); onUpdated(); toast('Sous-deal détaché');
    } catch (e) {
      toast((e as Error).message || 'Erreur lors du détachement', 'error');
    }
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
  // Regroupement d'affaires.
  const parentDeal = deal.parentDeal as any | null;
  const childDeals: any[] = deal.childDeals ?? [];
  const ownValue = typeof deal.dealValue === 'number' ? deal.dealValue : 0;
  const groupValue = ownValue + childDeals.reduce((s: number, c: any) => s + (c.dealValue || 0), 0);
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
              <button
                type="button"
                role="switch"
                aria-checked={!!deal.isPV}
                onClick={() => patchDeal({ isPV: !deal.isPV }, !deal.isPV ? 'Tag PV activé' : 'Tag PC activé')}
                title={deal.isPV ? 'Prospection de Valeur (activé = PV)' : 'Prospection Classique (désactivé = PC)'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none',
                  background: 'none', border: 'none', padding: 0,
                  fontSize: 11, fontWeight: 700, color: deal.isPV ? '#15803d' : '#64748b',
                }}
              >
                {/* Interrupteur à bascule : vert = PV, gris = PC */}
                <span style={{
                  position: 'relative', width: 38, height: 22, borderRadius: 999, flexShrink: 0,
                  background: deal.isPV ? '#22c55e' : '#cbd5e1', transition: 'background .15s',
                }}>
                  <span style={{
                    position: 'absolute', top: 2, left: deal.isPV ? 18 : 2, width: 18, height: 18,
                    borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.25)',
                    transition: 'left .15s',
                  }} />
                </span>
                {deal.isPV ? 'PV' : 'PC'}
              </button>
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

          {/* Bannière regroupement : sous-deals rattachés (deal parent) ou
              rattachement à une affaire parente (sous-deal). */}
          {parentDeal && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '8px 11px' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', letterSpacing: '.3px' }}>🏬 Gérée par</span>
              <button
                onClick={() => onNavigate?.(parentDeal.id)}
                title="Ouvrir l'affaire parente"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #ddd6fe', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600, color: '#5b21b6', cursor: onNavigate ? 'pointer' : 'default' }}
              >
                {parentDeal.store?.name || 'Affaire'} →
              </button>
            </div>
          )}
          {childDeals.length > 0 && (
            <div style={{ marginTop: 10, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '9px 11px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', letterSpacing: '.3px' }}>🏬 Magasins du groupe ({childDeals.length})</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#15803d', marginLeft: 'auto' }}>Total {groupValue.toLocaleString('fr-FR')} €</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {childDeals.map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => onNavigate?.(c.id)}
                    title={`Ouvrir ${c.store?.name || 'le sous-deal'}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 500, color: '#334155', cursor: onNavigate ? 'pointer' : 'default' }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: c.store?.brand?.color || '#94a3b8' }} />
                    {c.store?.name || 'Magasin'}
                    {typeof c.dealValue === 'number' && c.dealValue !== 0 && (
                      <span style={{ color: '#15803d', fontWeight: 700 }}>{c.dealValue.toLocaleString('fr-FR')} €</span>
                    )}
                  </button>
                ))}
              </div>
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
              <div style={{ display: 'flex', gap: 8, fontSize: 12.5, marginBottom: 6, alignItems: 'center' }}>
                <span style={{ width: 96, flexShrink: 0, color: '#94a3b8' }}>Magasin</span>
                <input
                  style={{ ...inp, flex: 1, padding: '4px 8px', fontSize: 12.5 }}
                  value={fields.storeName ?? ''}
                  placeholder="Nom du magasin"
                  onChange={e => setFields(f => ({ ...f, storeName: e.target.value }))}
                  onBlur={() => {
                    const v = (fields.storeName ?? '').trim();
                    if (v && v !== (store?.name ?? '')) patchDeal({ storeName: v }, 'Nom du magasin mis à jour');
                  }}
                />
              </div>
              {[['Ville', store?.city], ['Département', store?.department]].map(([l, v]) => (
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
                <label style={labelStyle}>Date de la démo</label>
                <input
                  type="datetime-local" style={inp} value={fields.demoDate ?? ''}
                  onChange={e => { setFields(f => ({ ...f, demoDate: e.target.value })); patchDeal({ demoDate: e.target.value ? new Date(e.target.value).toISOString() : null }); }}
                />
                {(deal.column?.title === 'Démo prévue' || deal.column?.title === 'DEMO PREVUE') && (
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

            <div style={sectionTitle}>Regroupement</div>
            <div style={{ marginBottom: 18 }}>
              {parentDeal ? (
                /* L'affaire est un sous-deal : gérée par une autre affaire. */
                <div style={{ border: '1px solid #ddd6fe', background: '#f5f3ff', borderRadius: 8, padding: '10px 11px' }}>
                  <div style={{ fontSize: 11, color: '#7c3aed', fontWeight: 700, marginBottom: 4 }}>Gérée par</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {parentDeal.store?.name || 'Affaire'}
                      </div>
                      {parentDeal.store?.brand?.name && <div style={{ fontSize: 11, color: '#94a3b8' }}>{parentDeal.store.brand.name}</div>}
                    </div>
                    {onNavigate && (
                      <button onClick={() => onNavigate(parentDeal.id)} style={{ ...btnDef, padding: '4px 9px', fontSize: 11 }}>Ouvrir →</button>
                    )}
                  </div>
                  <button onClick={detachFromParent} style={{ marginTop: 8, background: 'none', border: 'none', color: '#dc2626', fontSize: 11.5, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                    Détacher de cette affaire
                  </button>
                </div>
              ) : (
                /* L'affaire est autonome ou parente. */
                <>
                  {childDeals.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>Magasins du groupe ({childDeals.length})</span>
                        <span style={{ fontSize: 11.5, color: '#15803d', fontWeight: 700 }}>Total {groupValue.toLocaleString('fr-FR')} €</span>
                      </div>
                      {childDeals.map((c: any) => (
                        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: c.store?.brand?.color || '#94a3b8' }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.store?.name || 'Magasin'}</div>
                            <div style={{ fontSize: 10.5, color: '#94a3b8' }}>
                              {[c.store?.city, c.column?.title, typeof c.dealValue === 'number' && c.dealValue !== 0 ? `${c.dealValue.toLocaleString('fr-FR')} €` : null].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          {onNavigate && <button onClick={() => onNavigate(c.id)} title="Ouvrir le sous-deal" style={{ ...btnDef, padding: '3px 8px', fontSize: 11 }}>→</button>}
                          <button onClick={() => detachChild(c.id)} title="Détacher" style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: 13, cursor: 'pointer', padding: 0, flexShrink: 0 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {showParentSearch ? (
                    <div style={{ border: '1px solid #c7d2fe', borderRadius: 8, padding: 11, background: '#f8fafc' }}>
                      <label style={labelStyle}>Rechercher l&apos;affaire qui gérera celle-ci</label>
                      <input style={inp} autoFocus placeholder="Nom du magasin, ville, enseigne…" value={parentQuery} onChange={e => setParentQuery(e.target.value)} />
                      <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto' }}>
                        {searchingParent && parentResults.length === 0 && <p style={{ fontSize: 12, color: '#94a3b8' }}>Recherche…</p>}
                        {!searchingParent && parentQuery.trim().length >= 2 && parentResults.length === 0 && <p style={{ fontSize: 12, color: '#94a3b8' }}>Aucune affaire éligible.</p>}
                        {parentResults.map((r: any) => (
                          <button key={r.id} onClick={() => attachToParent(r.id)}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', padding: '7px 4px', borderBottom: '1px solid #f1f5f9' }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: r.store?.brand?.color || '#94a3b8' }} />
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.store?.name || 'Affaire'}</span>
                              <span style={{ display: 'block', fontSize: 11, color: '#94a3b8' }}>{[r.store?.brand?.name, r.store?.city, r.column?.title].filter(Boolean).join(' · ')}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                      <button style={{ ...btnDef, marginTop: 8 }} onClick={() => { setShowParentSearch(false); setParentQuery(''); setParentResults([]); }}>Annuler</button>
                    </div>
                  ) : (
                    <button onClick={() => setShowParentSearch(true)} style={{ ...btnDef, width: '100%', background: '#fff', padding: '8px 12px' }}>
                      🏬 Rattacher à une autre affaire
                    </button>
                  )}
                  <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
                    Rattacher cette affaire la fait disparaître du pipeline ; elle reste accessible via son affaire parente et la recherche.
                  </p>
                </>
              )}
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

            {/* Onglets : Activité / Recrutement */}
            <div style={{ display: 'flex', gap: 22, borderBottom: '1px solid #e2e8f0', marginBottom: 20 }}>
              {([['activite', 'Activité'], ['abonnement', 'Abonnement'], ['recrutement', 'Recrutement'], ['proches', 'Magasins proches']] as const).map(([key, label]) => {
                const active = activeTab === key;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 10px',
                      fontSize: 13.5, fontWeight: active ? 700 : 500,
                      color: active ? '#4338ca' : '#64748b',
                      borderBottom: active ? '2px solid #4338ca' : '2px solid transparent',
                      marginBottom: -1,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {activeTab === 'activite' && (
            <>
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
                  <RichTextEditor value={emailBody} onChange={setEmailBody} placeholder="Corps de l'email…" minHeight={160} />
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
                      {item.kind === 'note' && <NoteItem note={item.data as Note} onSave={editNote} onDelete={deleteNote} />}
                      {item.kind === 'action' && <DoneActionItem action={item.data} onReopen={() => reopenAction(item.data.id)} onDelete={() => deleteAction(item.data.id)} />}
                      {item.kind === 'email' && <EmailLogItem log={item.data as EmailLog} />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            </>
            )}

            {activeTab === 'abonnement' && (
              <div style={{ maxWidth: 640 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={sectionTitle}>Abonnements ({subs.length}/2)</div>
                  {subs.length > 0 && subs.length < 2 && (
                    <button type="button" onClick={addSub} style={{ ...btnDef, padding: '6px 12px', fontSize: 12 }}>
                      + Ajouter un 2ᵉ abonnement
                    </button>
                  )}
                </div>

                {subs.length === 0 ? (
                  <div style={{ background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 12, padding: 24, textAlign: 'center', color: '#94a3b8' }}>
                    <div style={{ fontSize: 13, marginBottom: 12 }}>Aucun abonnement sur cette affaire.</div>
                    <button type="button" onClick={addSub} style={{ ...btnPri, padding: '8px 16px', fontSize: 13 }}>+ Créer un abonnement</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {subs.map((s, i) => (
                      <SubscriptionCard key={s.id} sub={s} index={i} subscriptionTypes={subscriptionTypes} onPatch={patchSub} onDelete={deleteSub} />
                    ))}
                  </div>
                )}

                {subs.length > 0 && (
                  <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                    <span style={{ fontSize: 12.5, color: '#475569' }}>Valeur totale de l&apos;affaire :</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: '#15803d' }}>
                      {formatCurrency(subs.reduce((t, s) => t + (s.value || 0), 0)) || '0 €'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'recrutement' && <RecruitmentTab dealId={dealId} />}

            {activeTab === 'proches' && <NearbyTab dealId={dealId} onNavigate={onNavigate} />}

          </div>
        </div>
      </div>
    </div>
  );
}

function NoteItem({ note, onSave, onDelete }: { note: Note; onSave: (id: string, content: string) => void; onDelete: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  useEffect(() => { setDraft(note.content); }, [note.content]);

  if (editing) {
    return (
      <div>
        <textarea style={{ ...inp, height: 70, resize: 'vertical', marginBottom: 8 }} value={draft} onChange={e => setDraft(e.target.value)} autoFocus />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            style={{ ...btnPri, padding: '5px 12px', fontSize: 12 }}
            onClick={() => { const v = draft.trim(); if (v && v !== note.content) onSave(note.id, v); setEditing(false); }}
          >
            Enregistrer
          </button>
          <button style={{ ...btnDef, padding: '5px 12px', fontSize: 12 }} onClick={() => { setDraft(note.content); setEditing(false); }}>Annuler</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginBottom: 6, color: '#0f172a' }}>{note.content}</p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <p style={{ fontSize: 10.5, color: '#94a3b8', margin: 0 }}>
          {(note as any).authorName ? <span style={{ fontWeight: 600, color: '#64748b' }}>{(note as any).authorName}</span> : <span style={{ fontStyle: 'italic' }}>Anonyme</span>}
          {' · '}{formatDate(note.createdAt)}
        </p>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => setEditing(true)} title="Modifier la note" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 12, padding: 2 }}>✎</button>
          <button onClick={() => onDelete(note.id)} title="Supprimer la note" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 12, padding: 2 }}>🗑</button>
        </div>
      </div>
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
        isHtml(log.body)
          ? <div style={{ marginTop: 6, padding: '10px 12px', background: '#f8fafc', borderRadius: 6, fontSize: 12, color: '#334155', borderLeft: '3px solid #6366f1' }} dangerouslySetInnerHTML={{ __html: log.body }} />
          : <div style={{ marginTop: 6, padding: '10px 12px', background: '#f8fafc', borderRadius: 6, fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', borderLeft: '3px solid #6366f1' }}>{log.body}</div>
      )}
    </div>
  );
}

// ---- Onglet « Magasins proches » -------------------------------------------
// Liste les magasins du CRM situés à moins de 50 km (distance Haversine sur les
// coordonnées géocodées), filtrables par enseigne, avec l'étape de pipeline du
// deal associé. Clic → ouvre la fiche du magasin proche.
interface NearbyDealItem {
  dealId: string;
  storeName: string;
  brandName: string | null;
  brandColor: string | null;
  city: string;
  postalCode: string;
  columnTitle: string;
  columnColor: string;
  pipelineName: string;
  distanceKm: number;
}

function NearbyTab({ dealId, onNavigate }: { dealId: string; onNavigate?: (dealId: string) => void }) {
  const [items, setItems] = useState<NearbyDealItem[]>([]);
  const [originLocated, setOriginLocated] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [brand, setBrand] = useState('');
  const [pipeline, setPipeline] = useState('');
  const [allPipelines, setAllPipelines] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false);
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/nearby`);
        if (!res.ok) throw new Error();
        const d = await res.json();
        if (cancelled) return;
        setItems(d.deals || []);
        setOriginLocated(d.originLocated !== false);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dealId]);

  // Liste complète des pipelines du CRM (pour pouvoir filtrer sur n'importe
  // lequel, même sans magasin proche dans ce pipeline).
  useEffect(() => {
    fetch('/api/pipelines')
      .then((r) => r.json())
      .then((d) => setAllPipelines((d.pipelines || []).map((p: any) => p.name)))
      .catch(() => {});
  }, []);

  // Enseignes présentes (pour le filtre), triées par nombre de magasins.
  const brands = useMemo(() => {
    const map = new Map<string, { name: string; color: string; count: number }>();
    for (const it of items) {
      const name = it.brandName || 'Sans enseigne';
      const entry = map.get(name) || { name, color: it.brandColor || '#94a3b8', count: 0 };
      entry.count += 1;
      map.set(name, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [items]);

  // Filtre pipeline : tous les pipelines du CRM, avec le nombre de magasins
  // proches dans chacun (0 si aucun). On complète par d'éventuels pipelines
  // présents dans les résultats mais absents de la liste chargée.
  const pipelines = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) {
      const name = it.pipelineName || '—';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    const names = Array.from(new Set(allPipelines.concat(Array.from(counts.keys()))));
    return names.map((name) => ({ name, count: counts.get(name) || 0 }));
  }, [items, allPipelines]);

  const visible = useMemo(
    () => items.filter((it) =>
      (!brand || (it.brandName || 'Sans enseigne') === brand) &&
      (!pipeline || (it.pipelineName || '—') === pipeline),
    ),
    [items, brand, pipeline],
  );

  if (loading) return <p style={{ color: '#94a3b8', fontSize: 13 }}>Chargement des magasins proches…</p>;
  if (error) return <p style={{ color: '#b91c1c', fontSize: 13 }}>Impossible de charger les magasins proches.</p>;
  if (!originLocated) return (
    <p style={{ color: '#94a3b8', fontSize: 13 }}>
      Ce magasin n&apos;est pas encore géolocalisé : impossible de calculer les distances. Vérifiez son adresse, puis ouvrez la carte pour déclencher le géocodage.
    </p>
  );

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#475569' }}>
          <strong style={{ color: '#4338ca' }}>{visible.length}</strong> magasin{visible.length > 1 ? 's' : ''} à moins de 50&nbsp;km
        </span>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <select value={pipeline} onChange={(e) => setPipeline(e.target.value)} style={{ ...inp, width: 'auto', padding: '6px 10px', fontSize: 12.5 }}>
            <option value="">Tous les pipelines</option>
            {pipelines.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.count})</option>)}
          </select>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} style={{ ...inp, width: 'auto', padding: '6px 10px', fontSize: 12.5 }}>
            <option value="">Toutes les enseignes</option>
            {brands.map((b) => <option key={b.name} value={b.name}>{b.name} ({b.count})</option>)}
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Aucun magasin à moins de 50&nbsp;km{brand || pipeline ? ' pour ce filtre' : ''}.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {visible.map((it) => (
            <button
              key={it.dealId}
              onClick={() => onNavigate?.(it.dealId)}
              title={onNavigate ? `Ouvrir ${it.storeName}` : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9, padding: '11px 13px',
                cursor: onNavigate ? 'pointer' : 'default',
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: it.brandColor || '#94a3b8', border: (it.brandColor || '').toLowerCase() === '#ffffff' ? '1px solid #cbd5e1' : 'none' }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {it.storeName}
                </span>
                <span style={{ display: 'block', fontSize: 11.5, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {[it.brandName, it.city].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#4338ca' }}>{it.distanceKm.toLocaleString('fr-FR')} km</span>
                <span title={`Pipeline « ${it.pipelineName} »`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, color: '#334155', background: '#f1f5f9', padding: '2px 8px', borderRadius: 999 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: it.columnColor || '#94a3b8' }} />
                  {it.columnTitle || '—'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ---- Onglet « Recrutement » ------------------------------------------------
// Regroupe par Organization produit (auto en « Démo prévue » ou ajoutée
// manuellement) les offres et leurs candidats likés. Gestion manuelle des
// organisations rattachées (ajout / retrait d'un organization_id).
interface RecruitmentCandidate { id: string; firstName: string; lastName: string; phoneNumber: string; }
interface RecruitmentOffer { id: string; title: string; candidates: RecruitmentCandidate[]; }
interface RecruitmentOrganization { organizationId: string; organizationName: string; offers: RecruitmentOffer[]; }
interface RecruitmentData { configured: boolean; organizations: RecruitmentOrganization[]; calledCandidateIds?: string[]; }

function RecruitmentTab({ dealId }: { dealId: string }) {
  const [data, setData] = useState<RecruitmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [calledIds, setCalledIds] = useState<Set<string>>(new Set());
  // Saisie manuelle d'un organization_id.
  const [newOrgId, setNewOrgId] = useState('');
  const [addingOrg, setAddingOrg] = useState(false);
  // Création à la volée de l'Organization dans Supabase (même logique que « Démo prévue »).
  const [creatingOrg, setCreatingOrg] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch(`/api/deals/${dealId}/recruitment`);
      if (!res.ok) throw new Error();
      const d = await res.json();
      setData(d);
      setCalledIds(new Set(d.calledCandidateIds || []));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const toggleCall = async (candidateId: string) => {
    const called = !calledIds.has(candidateId);
    setCalledIds(prev => {
      const next = new Set(prev);
      if (called) next.add(candidateId); else next.delete(candidateId);
      return next;
    });
    try {
      const res = await fetch(`/api/deals/${dealId}/recruitment/calls`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId, called }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setCalledIds(prev => {
        const next = new Set(prev);
        if (called) next.delete(candidateId); else next.add(candidateId);
        return next;
      });
      toast('Échec de l\'enregistrement', 'error');
    }
  };

  const addOrg = async () => {
    const organizationId = newOrgId.trim();
    if (!organizationId) return;
    setAddingOrg(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/organizations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Erreur');
      setNewOrgId('');
      toast('✓ Organisation rattachée');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Échec de l\'ajout', 'error');
    } finally {
      setAddingOrg(false);
    }
  };

  const createOrg = async () => {
    setCreatingOrg(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/provision-organization`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Erreur');
      toast(`✓ Organisation « ${body.organizationName} » créée dans Supabase`);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Échec de la création', 'error');
    } finally {
      setCreatingOrg(false);
    }
  };

  const removeOrg = async (organizationId: string) => {
    if (!window.confirm('Retirer cette organisation de l\'affaire ?')) return;
    try {
      const res = await fetch(`/api/deals/${dealId}/organizations`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      toast('Échec du retrait', 'error');
    }
  };

  const renderOffer = (offer: RecruitmentOffer) => {
    const open = !!expanded[offer.id];
    return (
      <div key={offer.id} style={{ border: '1px solid #e2e8f0', borderRadius: 9, marginBottom: 8, background: '#fff', overflow: 'hidden' }}>
        <button
          onClick={() => setExpanded(e => ({ ...e, [offer.id]: !e[offer.id] }))}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: open ? '#f5f3ff' : '#fff', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        >
          <span style={{ fontSize: 12, color: '#94a3b8', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>{offer.title}</span>
          <span style={{ fontSize: 11, fontWeight: 600, background: '#ede9fe', color: '#6d28d9', padding: '2px 8px', borderRadius: 999, flexShrink: 0 }}>
            {offer.candidates.length} candidat{offer.candidates.length > 1 ? 's' : ''}
          </span>
        </button>
        {open && (
          <div style={{ borderTop: '1px solid #e2e8f0', padding: '6px 14px 10px' }}>
            {offer.candidates.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: 12.5, margin: '8px 0' }}>Aucun candidat envoyé pour cette offre.</p>
            ) : (
              offer.candidates.map(c => {
                const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
                const called = calledIds.has(c.id);
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <button
                      onClick={() => toggleCall(c.id)}
                      title={called ? 'Appelé — cliquer pour décocher' : 'Marquer comme appelé'}
                      style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${called ? '#16a34a' : '#cbd5e1'}`, background: called ? '#16a34a' : 'transparent', color: '#fff', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, lineHeight: 1 }}
                    >
                      {called ? '✓' : ''}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: called ? '#94a3b8' : (fullName ? '#0f172a' : '#cbd5e1'), textDecoration: called ? 'line-through' : 'none' }}>{fullName || 'Nom inconnu'}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {c.phoneNumber
                          ? <a href={`tel:${c.phoneNumber}`} style={{ color: '#4f46e5', textDecoration: 'none' }}>📞 {c.phoneNumber}</a>
                          : <span style={{ color: '#cbd5e1' }}>Téléphone non renseigné</span>}
                      </div>
                    </div>
                    {called && <span style={{ fontSize: 10.5, color: '#16a34a', fontWeight: 600, flexShrink: 0 }}>Appelé</span>}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) return <p style={{ color: '#94a3b8', fontSize: 13 }}>Chargement du recrutement…</p>;
  if (error) return <p style={{ color: '#dc2626', fontSize: 13 }}>Erreur lors du chargement des données de recrutement.</p>;
  if (!data?.configured) return <p style={{ color: '#94a3b8', fontSize: 13 }}>Intégration Supabase produit non configurée.</p>;

  const orgs = data.organizations || [];

  return (
    <div>
      {/* Gestion des organisations rattachées */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 9, padding: 12, marginBottom: 16, background: '#f8fafc' }}>
        <div style={{ ...sectionTitle, marginBottom: 8 }}>Organisations rattachées</div>
        {orgs.length === 0 && (
          <>
            <p style={{ color: '#94a3b8', fontSize: 12.5, margin: '0 0 8px' }}>
              Aucune organisation. Elle est rattachée automatiquement en « Démo prévue » ; sinon créez-la ci-dessous (même logique : enseigne + nom du magasin, logo déduit) ou rattachez son <code>organization_id</code>.
            </p>
            <button
              style={{ ...btnPri, width: '100%', marginBottom: 8, opacity: creatingOrg ? .7 : 1, cursor: creatingOrg ? 'not-allowed' : 'pointer' }}
              onClick={createOrg}
              disabled={creatingOrg}
            >
              {creatingOrg ? '⟳ Création…' : 'Créer l\'Organization dans Supabase'}
            </button>
          </>
        )}
        {orgs.map(o => (
          <div key={o.organizationId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a' }}>{o.organizationName}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.organizationId}</div>
            </div>
            <button onClick={() => removeOrg(o.organizationId)} title="Retirer" style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '3px 7px', flexShrink: 0 }}>Retirer</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            style={{ ...inp, flex: 1, fontSize: 12, fontFamily: 'monospace' }}
            placeholder="organization_id Supabase (UUID)"
            value={newOrgId}
            onChange={e => setNewOrgId(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addOrg(); }}
          />
          <button style={{ ...btnPri, opacity: addingOrg ? .7 : 1, cursor: addingOrg ? 'not-allowed' : 'pointer' }} onClick={addOrg} disabled={addingOrg}>
            {addingOrg ? '⟳' : 'Ajouter'}
          </button>
        </div>
      </div>

      {/* Offres regroupées par organisation */}
      {orgs.map(o => (
        <div key={o.organizationId} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>🏢 {o.organizationName}</span>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{o.offers.length} offre{o.offers.length > 1 ? 's' : ''}</span>
          </div>
          {o.offers.length === 0
            ? <p style={{ color: '#94a3b8', fontSize: 12.5, margin: '0 0 4px' }}>Aucune offre pour cette organisation.</p>
            : o.offers.map(renderOffer)}
        </div>
      ))}
    </div>
  );
}
