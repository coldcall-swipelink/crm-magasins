'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import type { Brand, PipelineColumn } from '@/types';
import { toast } from '@/components/ui/Toast';
import RichTextEditor from '@/components/ui/RichTextEditor';
import PhoneLookupPanel from '@/components/settings/PhoneLookupPanel';
import DealsWithoutPhonePanel from '@/components/settings/DealsWithoutPhonePanel';
import PaymentLinksPanel from '@/components/settings/PaymentLinksPanel';
import { EMAIL_SENDERS, DEFAULT_EMAIL_SENDER, senderForUser } from '@/lib/emailSenders';
import { useCurrentUser } from '@/lib/currentUser';

const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: 13, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 };
const btnDef: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnXs: React.CSSProperties = { padding: '3px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', cursor: 'pointer', fontSize: 11 };

interface Collaborator { id: string; name: string; email: string; color: string; _count?: { deals: number }; }
/** Déclinaison d'un template pour une ou plusieurs enseignes (ex. « U » = Super U + Hyper U). */
interface TemplateVariant { id: string; brandIds: string[]; subject: string; body: string; }
interface EmailTemplate { id: string; name: string; subject: string; body: string; variants?: TemplateVariant[]; }
interface Pipeline { id: string; name: string; position: number; color: string; columns: PipelineColumn[]; }
interface SubscriptionType { id: string; name: string; position: number; }

const VARIABLES = ['{{civilite}}', '{{nom_famille}}', '{{email}}', '{{enseigne}}', '{{nom_magasin}}', '{{ville}}', '{{directeur}}', '{{contact_calling}}', '{{poste}}', '{{prenom_expediteur}}', '{{2mag}}'];

interface TemplateFormProps {
  value: EmailTemplate | { name: string; subject: string; body: string };
  brands: Brand[];
  onChange: (field: string, val: string) => void;
  onSave: () => void;
  onCancel: () => void;
  /** Rechargement des templates après création/modif/suppression d'une déclinaison. */
  onVariantsChanged: () => Promise<void> | void;
}

/**
 * Déclinaisons par enseigne d'un template enregistré : liste des déclinaisons
 * existantes + formulaire d'ajout/édition. Chaque déclinaison couvre une ou
 * plusieurs enseignes et porte son propre sujet/corps ; à l'application du
 * template depuis une affaire, la déclinaison de l'enseigne du magasin prime.
 */
function VariantsSection({ template, brands, onChanged }: {
  template: EmailTemplate;
  brands: Brand[];
  onChanged: () => Promise<void> | void;
}) {
  const [form, setForm] = useState<{ id?: string; brandIds: string[]; subject: string; body: string } | null>(null);
  const variants = template.variants || [];
  const brandName = (id: string) => brands.find(b => b.id === id)?.name || 'Enseigne supprimée';
  const toggleBrand = (id: string) => setForm(f => f
    ? { ...f, brandIds: f.brandIds.includes(id) ? f.brandIds.filter(x => x !== id) : [...f.brandIds, id] }
    : f);

  const save = async () => {
    if (!form) return;
    if (!form.brandIds.length) { toast('Choisissez au moins une enseigne', 'error'); return; }
    const url = form.id
      ? `/api/email-templates/${template.id}/variants/${form.id}`
      : `/api/email-templates/${template.id}/variants`;
    const res = await fetch(url, {
      method: form.id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandIds: form.brandIds, subject: form.subject, body: form.body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || 'Enregistrement impossible', 'error'); return; }
    const wasEdit = !!form.id;
    setForm(null);
    await onChanged();
    toast(wasEdit ? 'Déclinaison mise à jour' : 'Déclinaison ajoutée');
  };

  const remove = async (id: string) => {
    if (!confirm('Supprimer cette déclinaison ?')) return;
    await fetch(`/api/email-templates/${template.id}/variants/${id}`, { method: 'DELETE' });
    if (form?.id === id) setForm(null);
    await onChanged();
    toast('Déclinaison supprimée');
  };

  return (
    <div style={{ borderTop: '1px dashed #e2e8f0', paddingTop: 12, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Déclinaisons par enseigne</div>
        {!form && (
          // Nouvelle déclinaison pré-remplie avec le sujet/corps de base : on
          // part du texte commun et on n'adapte que ce qui change.
          <button style={btnXs} onClick={() => setForm({ brandIds: [], subject: template.subject, body: template.body })}>
            + Décliner pour une enseigne
          </button>
        )}
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
        Depuis une affaire, la déclinaison dont l&apos;enseigne correspond au magasin remplace automatiquement
        le sujet et le corps de base du template.
      </div>

      {variants.map(v => form?.id === v.id ? null : (
        <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', marginBottom: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {v.brandIds.map(id => (
                <span key={id} style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: '#eef2ff', color: '#4338ca' }}>{brandName(id)}</span>
              ))}
            </div>
            {v.subject && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{v.subject.slice(0, 60)}{v.subject.length > 60 ? '…' : ''}</div>}
          </div>
          <button style={btnXs} onClick={() => setForm({ id: v.id, brandIds: [...v.brandIds], subject: v.subject, body: v.body })}>✎</button>
          <button style={btnXs} onClick={() => remove(v.id)}>🗑</button>
        </div>
      ))}
      {!variants.length && !form && (
        <div style={{ fontSize: 12, color: '#cbd5e1' }}>Aucune déclinaison : toutes les affaires reçoivent la version de base.</div>
      )}

      {form && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginTop: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Enseignes couvertes</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {brands.map(b => {
              const on = form.brandIds.includes(b.id);
              return (
                <button key={b.id} type="button" onClick={() => toggleBrand(b.id)}
                  style={{
                    padding: '3px 10px', borderRadius: 12, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    border: on ? '1px solid #4f46e5' : '1px solid #e2e8f0',
                    background: on ? '#eef2ff' : '#fff', color: on ? '#4338ca' : '#64748b',
                  }}>
                  {b.name}
                </button>
              );
            })}
            {!brands.length && <span style={{ fontSize: 12, color: '#94a3b8' }}>Créez d&apos;abord des enseignes (section « Enseignes » ci-dessous).</span>}
          </div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Sujet</label>
          <input style={{ ...inp, marginBottom: 10 }} value={form.subject}
            onChange={e => setForm(f => f ? { ...f, subject: e.target.value } : f)} />
          <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Corps du message</label>
          <RichTextEditor
            value={form.body}
            onChange={html => setForm(f => f ? { ...f, body: html } : f)}
            variables={VARIABLES}
            minHeight={160}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button style={btnPri} onClick={save}>{form.id ? 'Enregistrer la déclinaison' : 'Ajouter la déclinaison'}</button>
            <button style={btnDef} onClick={() => setForm(null)}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateForm({ value, brands, onChange, onSave, onCancel, onVariantsChanged }: TemplateFormProps) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18, marginBottom: 12, boxShadow: '0 1px 2px rgba(15,23,42,.04)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Nom du template</label>
          <input style={inp} placeholder="Ex: Première prise de contact" value={value.name}
            onChange={e => onChange('name', e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Sujet</label>
          <input style={inp} placeholder="Ex: Votre offre d'emploi - {{enseigne}} {{nom_magasin}}" value={value.subject}
            onChange={e => onChange('subject', e.target.value)} />
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Corps du message</label>
        <RichTextEditor
          value={value.body}
          onChange={html => onChange('body', html)}
          variables={VARIABLES}
          placeholder={"Bonjour {{civilite}} {{nom_famille}},\n\nJe me permets de vous contacter concernant votre offre…"}
          minHeight={200}
        />
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
          Mise en forme (gras, police, listes…) via la barre d'outils. Cliquez une variable pour l'insérer au curseur ; elle sera remplacée à l'envoi.
        </div>
      </div>
      {'id' in value ? (
        <VariantsSection template={value} brands={brands} onChanged={onVariantsChanged} />
      ) : (
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 14 }}>
          Enregistrez le template pour pouvoir le décliner par enseigne (Leclerc, U, Intermarché…).
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={btnPri} onClick={onSave}>Enregistrer</button>
        <button style={btnDef} onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [subTypes, setSubTypes] = useState<SubscriptionType[]>([]);
  const [newSubType, setNewSubType] = useState('');
  const [editSubType, setEditSubType] = useState<SubscriptionType | null>(null);
  const [newBrand, setNewBrand] = useState({ name: '', color: '#6366f1' });
  const [editBrand, setEditBrand] = useState<Brand | null>(null);
  const [newColTitle, setNewColTitle] = useState('');
  const [newColColor, setNewColColor] = useState('#6366f1');
  const [newCollab, setNewCollab] = useState({ name: '', email: '', color: '#6366f1' });
  const [editCollab, setEditCollab] = useState<Collaborator | null>(null);
  const [editTemplate, setEditTemplate] = useState<EmailTemplate | null>(null);
  const [newTemplate, setNewTemplate] = useState({ name: '', subject: '', body: '' });
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  // Signature par expéditeur (une par adresse @swipelink.fr). La signature
  // « globale » héritée sert de valeur par défaut si un expéditeur n'en a pas.
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [sigSender, setSigSender] = useState(DEFAULT_EMAIL_SENDER.email);
  // Pré-sélectionner la signature du compte connecté (l'identité arrive après
  // le premier rendu, via localStorage) tant qu'aucun choix manuel n'a été fait.
  const { user: currentUser } = useCurrentUser();
  const sigSenderTouched = useRef(false);
  useEffect(() => {
    if (sigSenderTouched.current) return;
    const own = senderForUser(currentUser);
    if (own) setSigSender(own.email);
  }, [currentUser]);
  // Mode d'édition de la signature : éditeur visuel (WYSIWYG) ou code HTML brut.
  const [sigMode, setSigMode] = useState<'visual' | 'html'>('visual');
  const [savingSig, setSavingSig] = useState(false);
  const [savingCols, setSavingCols] = useState(false);
  // Backfill : rattachement des affaires existantes à leur Organization Supabase.
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const colorTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const fetchAll = useCallback(async () => {
    const [bRes, pRes, collRes, tRes, stRes] = await Promise.all([
      fetch('/api/brands'),
      fetch('/api/pipelines'),
      fetch('/api/collaborators'),
      fetch('/api/email-templates'),
      fetch('/api/subscription-types'),
    ]);
    if (bRes.ok) setBrands(await bRes.json());
    if (pRes.ok) {
      const pData = await pRes.json();
      setPipelines(pData.pipelines || []);
    }
    if (collRes.ok) setCollaborators(await collRes.json());
    if (tRes.ok) setTemplates(await tRes.json());
    if (stRes.ok) setSubTypes(await stRes.json());
  }, []);

  // Chargement des signatures email. Chaque expéditeur sans signature dédiée
  // est pré-rempli avec la signature globale héritée (repli), pour ne pas
  // « perdre » la signature déjà en place.
  useEffect(() => {
    fetch('/api/email-signature')
      .then(r => r.json())
      .then(d => {
        const glob: string = d.value || '';
        const sigs: Record<string, string> = d.signatures || {};
        const filled: Record<string, string> = {};
        for (const s of EMAIL_SENDERS) filled[s.email] = sigs[s.email] || glob;
        setSignatures(filled);
      })
      .catch(() => {});
  }, []);

  // Valeur de la signature de l'expéditeur en cours d'édition.
  const currentSig = signatures[sigSender] ?? '';
  const setCurrentSig = (val: string) => setSignatures(prev => ({ ...prev, [sigSender]: val }));

  const saveSignature = async () => {
    setSavingSig(true);
    try {
      const res = await fetch('/api/email-signature', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: sigSender, value: currentSig }),
      });
      if (!res.ok) throw new Error();
      toast('✓ Signature enregistrée');
    } catch {
      toast('Échec de l\'enregistrement', 'error');
    } finally {
      setSavingSig(false);
    }
  };

  // Charger la sélection depuis localStorage au démarrage
  useEffect(() => {
    const saved = localStorage.getItem('selectedPipelineId');
    if (saved) {
      setSelectedPipelineId(saved);
    }
  }, []);

  // Initialiser avec le premier pipeline si aucune sélection
  useEffect(() => {
    if (pipelines.length > 0 && !selectedPipelineId) {
      setSelectedPipelineId(pipelines[0].id);
    }
  }, [pipelines, selectedPipelineId]);

  // Sauvegarder la sélection dans localStorage
  useEffect(() => {
    if (selectedPipelineId) {
      localStorage.setItem('selectedPipelineId', selectedPipelineId);
    }
  }, [selectedPipelineId]);
  
  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Recharge les templates après une opération sur les déclinaisons, en
  // rafraîchissant aussi la copie en cours d'édition — sans toucher au nom,
  // sujet et corps de base que l'utilisateur est peut-être en train de modifier.
  const refreshTemplateVariants = useCallback(async () => {
    const res = await fetch('/api/email-templates');
    if (!res.ok) return;
    const fresh: EmailTemplate[] = await res.json();
    setTemplates(fresh);
    setEditTemplate(prev => {
      if (!prev) return prev;
      const updated = fresh.find(t => t.id === prev.id);
      return updated ? { ...prev, variants: updated.variants } : prev;
    });
  }, []);

  const currentPipeline = pipelines.find(p => p.id === selectedPipelineId);
  const columns = (currentPipeline?.columns || []).sort((a, b) => a.position - b.position);

  const addBrand = async () => {
    if (!newBrand.name.trim()) return;
    await fetch('/api/brands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newBrand) });
    setNewBrand({ name: '', color: '#6366f1' });
    await fetchAll();
    toast('Enseigne ajoutée');
  };

  const saveBrand = async () => {
    if (!editBrand) return;
    await fetch(`/api/brands/${editBrand.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editBrand.name, color: editBrand.color }) });
    setEditBrand(null);
    await fetchAll();
    toast('Enseigne mise à jour');
  };

  const deleteBrand = async (id: string) => {
    if (!confirm('Supprimer cette enseigne ?')) return;
    await fetch(`/api/brands/${id}`, { method: 'DELETE' });
    await fetchAll();
    toast('Supprimée');
  };
  
  // Met à jour une colonne du pipeline courant dans l'état local (optimiste).
  const patchColumnState = (colId: string, patch: Partial<PipelineColumn>) => {
    setPipelines(prev => prev.map(p =>
      p.id === selectedPipelineId
        ? { ...p, columns: p.columns.map(c => (c.id === colId ? { ...c, ...patch } : c)) }
        : p
    ));
  };

  const addColumn = async () => {
    if (!newColTitle.trim() || !selectedPipelineId) return;
    const res = await fetch('/api/columns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelineId: selectedPipelineId, title: newColTitle.trim(), color: newColColor }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast(data.error || 'Erreur lors de la création', 'error');
      return;
    }
    setNewColTitle('');
    await fetchAll();
    toast('Colonne ajoutée');
  };

  const deleteColumn = async (id: string) => {
    // Optimiste : on retire la colonne tout de suite, rollback si le serveur refuse.
    const snapshot = pipelines;
    setPipelines(prev => prev.map(p =>
      p.id === selectedPipelineId ? { ...p, columns: p.columns.filter(c => c.id !== id) } : p
    ));
    const res = await fetch(`/api/columns/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setPipelines(snapshot);
      toast(data.error || 'Suppression impossible', 'error');
      return;
    }
    await fetchAll();
    toast('Colonne supprimée');
  };

  // Couleur : MAJ instantanée de l'UI + persistance debouncée (le color-picker
  // émet beaucoup d'événements pendant le glissement → on n'envoie qu'à la fin).
  const updateColColor = (id: string, color: string) => {
    patchColumnState(id, { color });
    clearTimeout(colorTimers.current[id]);
    colorTimers.current[id] = setTimeout(async () => {
      try {
        const res = await fetch(`/api/columns/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ color }),
        });
        if (!res.ok) throw new Error();
      } catch {
        toast('Erreur enregistrement de la couleur', 'error');
        await fetchAll();
      }
    }, 400);
  };

  const moveColumn = async (colId: string, direction: 'up' | 'down') => {
    if (savingCols) return; // évite les opérations concurrentes (clics rapides)
    const ordered = [...columns];
    const idx = ordered.findIndex(c => c.id === colId);
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || target < 0 || target >= ordered.length) return;

    // Échange les deux colonnes puis renumérote les positions 0..n-1 (évite
    // les collisions / trous de position).
    [ordered[idx], ordered[target]] = [ordered[target], ordered[idx]];
    const renumbered = ordered.map((c, i) => ({ ...c, position: i }));

    // MAJ instantanée de l'UI.
    setPipelines(prev => prev.map(p =>
      p.id === selectedPipelineId ? { ...p, columns: renumbered } : p
    ));

    // Persiste en parallèle ; resynchronise sur le serveur en cas d'échec.
    setSavingCols(true);
    try {
      const results = await Promise.all(renumbered.map(c =>
        fetch(`/api/columns/${c.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position: c.position }),
        })
      ));
      if (results.some(r => !r.ok)) throw new Error();
    } catch {
      toast('Erreur lors du réordonnancement', 'error');
      await fetchAll();
    } finally {
      setSavingCols(false);
    }
  };

  const addCollab = async () => {
    if (!newCollab.name.trim()) return;
    await fetch('/api/collaborators', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newCollab) });
    setNewCollab({ name: '', email: '', color: '#6366f1' });
    await fetchAll();
    toast('Collaborateur ajouté');
  };

  const saveCollab = async () => {
    if (!editCollab) return;
    await fetch(`/api/collaborators/${editCollab.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editCollab.name, email: editCollab.email, color: editCollab.color }) });
    setEditCollab(null);
    await fetchAll();
    toast('Collaborateur mis à jour');
  };

  const deleteCollab = async (id: string) => {
    if (!confirm('Supprimer ce collaborateur ?')) return;
    await fetch(`/api/collaborators/${id}`, { method: 'DELETE' });
    await fetchAll();
    toast('Supprimé');
  };

  const addTemplate = async () => {
    if (!newTemplate.name.trim()) return;
    await fetch('/api/email-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newTemplate) });
    setNewTemplate({ name: '', subject: '', body: '' });
    setShowNewTemplate(false);
    await fetchAll();
    toast('Template ajouté');
  };

  const saveTemplate = async () => {
    if (!editTemplate) return;
    await fetch(`/api/email-templates/${editTemplate.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editTemplate) });
    setEditTemplate(null);
    await fetchAll();
    toast('Template mis à jour');
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm('Supprimer ce template ?')) return;
    await fetch(`/api/email-templates/${id}`, { method: 'DELETE' });
    await fetchAll();
    toast('Supprimé');
  };

  const addSubType = async () => {
    if (!newSubType.trim()) return;
    const res = await fetch('/api/subscription-types', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newSubType.trim(), position: subTypes.length }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast(d.error || 'Erreur', 'error'); return; }
    setNewSubType('');
    await fetchAll();
    toast('Type d\'abonnement ajouté');
  };

  const saveSubType = async () => {
    if (!editSubType) return;
    const res = await fetch(`/api/subscription-types/${editSubType.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editSubType.name }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast(d.error || 'Erreur', 'error'); return; }
    setEditSubType(null);
    await fetchAll();
    toast('Type d\'abonnement mis à jour');
  };

  const deleteSubType = async (id: string) => {
    if (!confirm('Supprimer ce type d\'abonnement ?')) return;
    await fetch(`/api/subscription-types/${id}`, { method: 'DELETE' });
    await fetchAll();
    toast('Supprimé');
  };

  // Backfill : fige l'organization_id Supabase sur les affaires existantes qui
  // n'en ont pas encore (retrouvé par nom). En dry-run d'abord (aperçu), puis
  // apply=true pour écrire. Une fois figé, le lien ne dépend plus du nom.
  const runBackfill = async (apply: boolean) => {
    if (apply && !window.confirm('Figer l\'organization_id sur toutes les affaires correspondantes ? (les liens déjà figés ne sont pas écrasés)')) return;
    setBackfillRunning(true);
    setBackfillResult(null);
    try {
      const res = await fetch(`/api/admin/link-organizations?token=sync-crm-2026${apply ? '&apply=true' : ''}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Erreur');
      const s = body.summary || {};
      setBackfillResult(
        `${apply ? 'Appliqué' : 'Aperçu'} — ${s.total ?? 0} affaire(s) sans id examinée(s) : `
        + `${s.matched ?? 0} correspondance(s) unique(s), ${s.ambiguous ?? 0} ambiguë(s), ${s.notFound ?? 0} sans correspondance`
        + (apply ? `. ${s.updated ?? 0} affaire(s) mise(s) à jour.` : ' (rien écrit).'),
      );
      toast(apply ? '✓ Backfill appliqué' : '✓ Aperçu généré');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Échec du backfill', 'error');
    } finally {
      setBackfillRunning(false);
    }
  };

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', padding: '8px 12px', marginBottom: 6 };

  return (
    <AppLayout>
      <div style={{ padding: '24px', maxWidth: 700 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Paramètres</div>

        {/* Templates email */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Templates email</div>
            <button style={{ ...btnPri, padding: '4px 10px', fontSize: 12 }} onClick={() => { setShowNewTemplate(true); setEditTemplate(null); }}>+ Nouveau</button>
          </div>

          {showNewTemplate && (
            <TemplateForm
              value={newTemplate}
              brands={brands}
              onChange={(field, val) => setNewTemplate(t => ({ ...t, [field]: val }))}
              onSave={addTemplate}
              onCancel={() => { setShowNewTemplate(false); setNewTemplate({ name: '', subject: '', body: '' }); }}
              onVariantsChanged={refreshTemplateVariants}
            />
          )}

          {templates.map(t => editTemplate?.id === t.id ? (
            <TemplateForm
              key={t.id}
              value={editTemplate}
              brands={brands}
              onChange={(field, val) => setEditTemplate(x => x ? { ...x, [field]: val } : null)}
              onSave={saveTemplate}
              onCancel={() => setEditTemplate(null)}
              onVariantsChanged={refreshTemplateVariants}
            />
          ) : (
            <div key={t.id} style={row}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>📧 {t.name}</div>
                {t.subject && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{t.subject.slice(0, 60)}{t.subject.length > 60 ? '…' : ''}</div>}
                {(t.variants?.length ?? 0) > 0 && (
                  <div style={{ fontSize: 10.5, color: '#4338ca', marginTop: 2 }}>
                    Décliné pour : {t.variants!.flatMap(v => v.brandIds).map(id => brands.find(b => b.id === id)?.name).filter(Boolean).join(', ') || '—'}
                  </div>
                )}
              </div>
              <button style={btnXs} onClick={() => { setEditTemplate({ ...t }); setShowNewTemplate(false); }}>✎</button>
              <button style={btnXs} onClick={() => deleteTemplate(t.id)}>🗑</button>
            </div>
          ))}
          {!templates.length && !showNewTemplate && <div style={{ fontSize: 13, color: '#94a3b8' }}>Aucun template. Créez-en un !</div>}
        </div>

        {/* Signature email (par expéditeur) */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Signature email</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>
            Ajoutée automatiquement à la fin des emails, selon l&apos;expéditeur choisi à l&apos;envoi.
            Chaque expéditeur peut avoir sa propre signature.
          </div>

          {/* Sélecteur d'expéditeur + bascule Visuel / Code HTML */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ minWidth: 220 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Expéditeur</label>
              <select style={{ ...inp, cursor: 'pointer' }} value={sigSender} onChange={e => { sigSenderTouched.current = true; setSigSender(e.target.value); }}>
                {EMAIL_SENDERS.map(s => <option key={s.email} value={s.email}>{s.label} — {s.email}</option>)}
              </select>
            </div>
            <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 8, padding: 3, gap: 3 }}>
              {(['visual', 'html'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSigMode(m)}
                  style={{
                    border: 'none', cursor: 'pointer', padding: '6px 14px', borderRadius: 6,
                    fontSize: 12, fontWeight: 600,
                    background: sigMode === m ? '#fff' : 'transparent',
                    color: sigMode === m ? '#4338ca' : '#64748b',
                    boxShadow: sigMode === m ? '0 1px 2px rgba(15,23,42,.12)' : 'none',
                  }}
                >
                  {m === 'visual' ? 'Éditeur visuel' : 'Code HTML'}
                </button>
              ))}
            </div>
          </div>

          {sigMode === 'visual' ? (
            <RichTextEditor
              value={currentSig}
              onChange={setCurrentSig}
              placeholder={"Cordialement,\nPrénom Nom\nSwipelink"}
              minHeight={140}
            />
          ) : (
            <>
              <textarea
                value={currentSig}
                onChange={e => setCurrentSig(e.target.value)}
                spellCheck={false}
                placeholder={'<table><tr><td>…</td></tr></table>\nCollez ici votre signature HTML.'}
                style={{
                  ...inp, minHeight: 160, fontFamily: 'Courier New, monospace', fontSize: 12.5,
                  lineHeight: 1.5, resize: 'vertical', whiteSpace: 'pre', overflowX: 'auto',
                }}
              />
              <div style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 8px' }}>
                Collez du HTML brut (balises, styles en ligne, images en URL absolue…). Il sera envoyé tel quel dans l&apos;email.
              </div>
              {/* Aperçu du rendu HTML */}
              <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Aperçu</div>
              <div style={{ border: '1px dashed #e2e8f0', borderRadius: 8, padding: 12, background: '#fff', minHeight: 40 }}>
                {currentSig.trim()
                  ? <div dangerouslySetInnerHTML={{ __html: currentSig }} />
                  : <span style={{ fontSize: 12, color: '#cbd5e1' }}>L&apos;aperçu s&apos;affichera ici.</span>}
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button style={{ ...btnPri, opacity: savingSig ? 0.7 : 1, cursor: savingSig ? 'not-allowed' : 'pointer' }} onClick={saveSignature} disabled={savingSig}>
              {savingSig ? '⟳ Enregistrement…' : `Enregistrer la signature de ${EMAIL_SENDERS.find(s => s.email === sigSender)?.label ?? sigSender}`}
            </button>
          </div>
        </div>

        {/* Collaborateurs */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Collaborateurs</div>
          {collaborators.map(c => editCollab?.id === c.id ? (
            <div key={c.id} style={row}>
              <input style={{ ...inp, flex: 1 }} placeholder="Nom" value={editCollab.name} onChange={e => setEditCollab(x => x ? { ...x, name: e.target.value } : null)} />
              <input style={{ ...inp, flex: 1 }} placeholder="Email" value={editCollab.email} onChange={e => setEditCollab(x => x ? { ...x, email: e.target.value } : null)} />
              <input type="color" value={editCollab.color} onChange={e => setEditCollab(x => x ? { ...x, color: e.target.value } : null)} style={{ width: 36, height: 32, borderRadius: 6, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
              <button style={btnPri} onClick={saveCollab}>✓</button>
              <button style={btnDef} onClick={() => setEditCollab(null)}>✕</button>
            </div>
          ) : (
            <div key={c.id} style={row}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: c.color, color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {c.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</div>
                {c.email && <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.email}</div>}
              </div>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{c._count?.deals ?? 0} affaires</span>
              <button style={btnXs} onClick={() => setEditCollab({ ...c })}>✎</button>
              <button style={btnXs} onClick={() => deleteCollab(c.id)}>🗑</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input style={{ ...inp, flex: 1 }} placeholder="Nom du collaborateur" value={newCollab.name} onChange={e => setNewCollab(c => ({ ...c, name: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addCollab()} />
            <input style={{ ...inp, flex: 1 }} placeholder="Email (optionnel)" value={newCollab.email} onChange={e => setNewCollab(c => ({ ...c, email: e.target.value }))} />
            <input type="color" value={newCollab.color} onChange={e => setNewCollab(c => ({ ...c, color: e.target.value }))} style={{ width: 38, height: 36, borderRadius: 7, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
            <button style={btnPri} onClick={addCollab}>+ Ajouter</button>
          </div>
        </div>

        {/* Enseignes */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Enseignes</div>
          {brands.map(b => editBrand?.id === b.id ? (
            <div key={b.id} style={row}>
              <input style={{ ...inp, flex: 1 }} value={editBrand.name} onChange={e => setEditBrand(x => x ? { ...x, name: e.target.value } : null)} />
              <input type="color" value={editBrand.color} onChange={e => setEditBrand(x => x ? { ...x, color: e.target.value } : null)} style={{ width: 36, height: 32, borderRadius: 6, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
              <button style={btnPri} onClick={saveBrand}>✓</button>
              <button style={btnDef} onClick={() => setEditBrand(null)}>✕</button>
            </div>
          ) : (
            <div key={b.id} style={row}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: b.color }} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{b.name}</span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{(b._count?.stores ?? 0)} magasins</span>
              <button style={btnXs} onClick={() => setEditBrand({ ...b })}>✎</button>
              <button style={btnXs} onClick={() => deleteBrand(b.id)}>🗑</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input style={{ ...inp, flex: 1 }} placeholder="Nom de l'enseigne" value={newBrand.name} onChange={e => setNewBrand(b => ({ ...b, name: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addBrand()} />
            <input type="color" value={newBrand.color} onChange={e => setNewBrand(b => ({ ...b, color: e.target.value }))} style={{ width: 38, height: 36, borderRadius: 7, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
            <button style={btnPri} onClick={addBrand}>+ Ajouter</button>
          </div>
        </div>

        {/* Types d'abonnement */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Types d&apos;abonnement</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>
            Valeurs sélectionnables dans l&apos;onglet « Abonnement » de chaque affaire.
          </div>
          {subTypes.map(s => editSubType?.id === s.id ? (
            <div key={s.id} style={row}>
              <input style={{ ...inp, flex: 1 }} value={editSubType.name} onChange={e => setEditSubType(x => x ? { ...x, name: e.target.value } : null)} onKeyDown={e => e.key === 'Enter' && saveSubType()} />
              <button style={btnPri} onClick={saveSubType}>✓</button>
              <button style={btnDef} onClick={() => setEditSubType(null)}>✕</button>
            </div>
          ) : (
            <div key={s.id} style={row}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>📦 {s.name}</span>
              <button style={btnXs} onClick={() => setEditSubType({ ...s })}>✎</button>
              <button style={btnXs} onClick={() => deleteSubType(s.id)}>🗑</button>
            </div>
          ))}
          {!subTypes.length && <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>Aucun type pour le moment.</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input style={{ ...inp, flex: 1 }} placeholder="Ex: Abonnement Standard, Premium…" value={newSubType} onChange={e => setNewSubType(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSubType()} />
            <button style={btnPri} onClick={addSubType}>+ Ajouter</button>
          </div>
        </div>

        {/* Colonnes par Pipeline */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Colonnes pipeline</div>
          
          {pipelines.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 6 }}>Sélectionner un pipeline</label>
              <select 
                value={selectedPipelineId} 
                onChange={e => setSelectedPipelineId(e.target.value)}
                style={{ ...inp, cursor: 'pointer' }}
              >
                {pipelines.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {columns.map((c, idx) => (
            <div 
              key={c.id} 
              style={{
                ...row,
                background: '#fff',
              }}
            >
              <input type="color" value={c.color} onChange={e => updateColColor(c.id, e.target.value)} style={{ width: 28, height: 28, borderRadius: 5, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
              <span style={{ flex: 1, fontSize: 13 }}>{c.title}</span>
              {c.position === 0 && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#eef2ff', color: '#4338ca', fontWeight: 500 }}>Par défaut</span>}
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{c._count?.deals ?? 0} affaires</span>
              
              <button
                style={{ ...btnXs, opacity: (idx === 0 || savingCols) ? 0.5 : 1, cursor: (idx === 0 || savingCols) ? 'not-allowed' : 'pointer' }}
                onClick={() => moveColumn(c.id, 'up')}
                disabled={idx === 0 || savingCols}
                title="Monter"
              >
                ↑
              </button>
              <button
                style={{ ...btnXs, opacity: (idx === columns.length - 1 || savingCols) ? 0.5 : 1, cursor: (idx === columns.length - 1 || savingCols) ? 'not-allowed' : 'pointer' }}
                onClick={() => moveColumn(c.id, 'down')}
                disabled={idx === columns.length - 1 || savingCols}
                title="Descendre"
              >
                ↓
              </button>
              <button style={btnXs} onClick={() => deleteColumn(c.id)}>🗑</button>
            </div>
          ))}
          
          {columns.length === 0 && <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>Aucune colonne pour ce pipeline.</div>}
          
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input style={{ ...inp, flex: 1 }} placeholder="Titre de la colonne" value={newColTitle} onChange={e => setNewColTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && addColumn()} />
            <input type="color" value={newColColor} onChange={e => setNewColColor(e.target.value)} style={{ width: 38, height: 36, borderRadius: 7, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
            <button style={btnPri} onClick={addColumn}>+ Ajouter</button>
          </div>
        </div>

        {/* Recherche automatique des numéros de téléphone des magasins */}
        <PhoneLookupPanel />

        {/* Reliquat de la recherche automatique : saisie manuelle des numéros */}
        <DealsWithoutPhonePanel />

        {/* Liens de paiement Stripe : catégories, libellés, ordre */}
        <PaymentLinksPanel />

        {/* Organisations produit (Supabase) — backfill */}
        <div style={{ marginBottom: 28, border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, background: '#f8fafc' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Organisations produit (Supabase)</div>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
            Fige l&apos;<code>organization_id</code> Supabase sur les affaires existantes qui n&apos;en ont pas encore, en le
            retrouvant par nom (« Enseigne Nom-magasin »). Une fois figé, le lien ne dépend plus du nom : le renommer côté
            Supabase ne le casse plus. Les affaires déjà rattachées ne sont pas écrasées.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...btnDef, opacity: backfillRunning ? 0.7 : 1, cursor: backfillRunning ? 'not-allowed' : 'pointer' }} onClick={() => runBackfill(false)} disabled={backfillRunning}>
              {backfillRunning ? '⟳…' : 'Aperçu (dry-run)'}
            </button>
            <button style={{ ...btnPri, opacity: backfillRunning ? 0.7 : 1, cursor: backfillRunning ? 'not-allowed' : 'pointer' }} onClick={() => runBackfill(true)} disabled={backfillRunning}>
              {backfillRunning ? '⟳…' : 'Appliquer le backfill'}
            </button>
          </div>
          {backfillResult && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: '#334155', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px' }}>
              {backfillResult}
            </div>
          )}
        </div>

        {/* Reset */}
        <div style={{ border: '1px solid #fecaca', borderRadius: 10, padding: 16, background: '#fef2f2' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#b91c1c', marginBottom: 6 }}>Réinitialisation</div>
          <p style={{ fontSize: 12, color: '#b91c1c', marginBottom: 10 }}>Supprime toutes les affaires, offres et imports.</p>
          <button style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontWeight: 500, cursor: 'pointer', fontSize: 13 }} onClick={() => toast('Pour réinitialiser : SQL DELETE FROM "Deal"; DELETE FROM "Store";', 'error')}>⚠ Réinitialiser</button>
        </div>
      </div>
    </AppLayout>
  );
}
