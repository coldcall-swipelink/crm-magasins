'use client';
import { useEffect, useState, useCallback } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import type { Brand, PipelineColumn } from '@/types';
import { toast } from '@/components/ui/Toast';

const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: 13, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 };
const btnDef: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnXs: React.CSSProperties = { padding: '3px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', cursor: 'pointer', fontSize: 11 };

interface Collaborator { id: string; name: string; email: string; color: string; _count?: { deals: number }; }
interface EmailTemplate { id: string; name: string; subject: string; body: string; }
interface Pipeline { id: string; name: string; position: number; color: string; columns: PipelineColumn[]; }

const VARIABLES = ['{{civilite}}', '{{enseigne}}', '{{nom_magasin}}', '{{ville}}', '{{directeur}}', '{{contact_calling}}', '{{poste}}', '{{prenom_expediteur}}'];

interface TemplateFormProps {
  value: EmailTemplate | { name: string; subject: string; body: string };
  onChange: (field: string, val: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function TemplateForm({ value, onChange, onSave, onCancel }: TemplateFormProps) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 10 }}>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3 }}>Nom du template</label>
        <input style={inp} placeholder="Ex: Première prise de contact" value={value.name}
          onChange={e => onChange('name', e.target.value)} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3 }}>Sujet</label>
        <input style={inp} placeholder="Ex: Votre offre d'emploi - {{enseigne}} {{nom_magasin}}" value={value.subject}
          onChange={e => onChange('subject', e.target.value)} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3 }}>Corps du message</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {VARIABLES.map(v => (
            <button key={v} onClick={() => onChange('body', (value.body || '') + v)}
              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: '1px solid #c7d2fe', background: '#eef2ff', color: '#4338ca', cursor: 'pointer' }}>
              {v}
            </button>
          ))}
        </div>
        <textarea
          style={{ ...inp, height: 160, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
          placeholder={"Bonjour {{civilite}},\n\nJe me permets de vous contacter concernant votre offre..."}
          value={value.body}
          onChange={e => onChange('body', e.target.value)}
        />
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
        Variables disponibles : {VARIABLES.join(' ')}
      </div>
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
  const [newBrand, setNewBrand] = useState({ name: '', color: '#6366f1' });
  const [editBrand, setEditBrand] = useState<Brand | null>(null);
  const [newColTitle, setNewColTitle] = useState('');
  const [newColColor, setNewColColor] = useState('#6366f1');
  const [newCollab, setNewCollab] = useState({ name: '', email: '', color: '#6366f1' });
  const [editCollab, setEditCollab] = useState<Collaborator | null>(null);
  const [editTemplate, setEditTemplate] = useState<EmailTemplate | null>(null);
  const [newTemplate, setNewTemplate] = useState({ name: '', subject: '', body: '' });
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [draggedCol, setDraggedCol] = useState<PipelineColumn | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const [bRes, pRes, collRes, tRes] = await Promise.all([
      fetch('/api/brands'),
      fetch('/api/pipelines'),
      fetch('/api/collaborators'),
      fetch('/api/email-templates'),
    ]);
    if (bRes.ok) setBrands(await bRes.json());
    if (pRes.ok) {
      const pData = await pRes.json();
      setPipelines(pData.pipelines || []);
    }
    if (collRes.ok) setCollaborators(await collRes.json());
    if (tRes.ok) setTemplates(await tRes.json());
  }, []);

  // Initialiser le pipeline au premier chargement
  useEffect(() => {
    if (pipelines.length > 0 && !selectedPipelineId) {
      setSelectedPipelineId(pipelines[0].id);
    }
  }, [pipelines, selectedPipelineId]);
  
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const currentPipeline = pipelines.find(p => p.id === selectedPipelineId);
  const columns = currentPipeline?.columns || [];

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
  
  const addColumn = async () => {
    if (!newColTitle.trim() || !selectedPipelineId) return;
    await fetch('/api/columns', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ pipelineId: selectedPipelineId, title: newColTitle, color: newColColor }) 
    });
    setNewColTitle('');
    await fetchAll();
    toast('Colonne ajoutée');
  };
  
  const deleteColumn = async (id: string) => {
    const res = await fetch(`/api/columns/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { toast(data.error, 'error'); return; }
    await fetchAll();
    toast('Colonne supprimée');
  };
  
  const updateColColor = async (id: string, color: string) => {
    await fetch(`/api/columns/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color }) });
  };

  const updateColPosition = async (id: string, newPosition: number) => {
    await fetch(`/api/columns/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position: newPosition }) });
  };

  const handleDragStart = (col: PipelineColumn) => {
    setDraggedCol(col);
  };

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    setDragOverId(colId);
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetCol: PipelineColumn) => {
    e.preventDefault();
    if (!draggedCol || draggedCol.id === targetCol.id) {
      setDraggedCol(null);
      setDragOverId(null);
      return;
    }
    
    // Créer une copie des colonnes triées
    const sorted = [...columns].sort((a, b) => a.position - b.position);
    const draggedIndex = sorted.findIndex(c => c.id === draggedCol.id);
    const targetIndex = sorted.findIndex(c => c.id === targetCol.id);
    
    // Réarranger le tableau
    const reordered = [...sorted];
    const [movedCol] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, movedCol);
    
    // Mettre à jour TOUTES les positions
    for (let i = 0; i < reordered.length; i++) {
      await updateColPosition(reordered[i].id, i);
    }
    
    setDraggedCol(null);
    setDragOverId(null);
    await fetchAll();
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
              onChange={(field, val) => setNewTemplate(t => ({ ...t, [field]: val }))}
              onSave={addTemplate}
              onCancel={() => { setShowNewTemplate(false); setNewTemplate({ name: '', subject: '', body: '' }); }}
            />
          )}

          {templates.map(t => editTemplate?.id === t.id ? (
            <TemplateForm
              key={t.id}
              value={editTemplate}
              onChange={(field, val) => setEditTemplate(x => x ? { ...x, [field]: val } : null)}
              onSave={saveTemplate}
              onCancel={() => setEditTemplate(null)}
            />
          ) : (
            <div key={t.id} style={row}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>📧 {t.name}</div>
                {t.subject && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{t.subject.slice(0, 60)}{t.subject.length > 60 ? '…' : ''}</div>}
              </div>
              <button style={btnXs} onClick={() => { setEditTemplate({ ...t }); setShowNewTemplate(false); }}>✎</button>
              <button style={btnXs} onClick={() => deleteTemplate(t.id)}>🗑</button>
            </div>
          ))}
          {!templates.length && !showNewTemplate && <div style={{ fontSize: 13, color: '#94a3b8' }}>Aucun template. Créez-en un !</div>}
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

          {[...columns].sort((a, b) => a.position - b.position).map(c => (
            <div 
              key={c.id} 
              style={{
                ...row,
                cursor: 'grab',
                background: dragOverId === c.id ? '#f0f4ff' : '#fff',
                borderColor: dragOverId === c.id ? '#4f46e5' : '#e2e8f0',
                opacity: draggedCol?.id === c.id ? 0.4 : 1,
                transition: 'all 0.2s'
              }}
              draggable
              onDragStart={() => handleDragStart(c)}
              onDragOver={(e) => handleDragOver(e, c.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, c)}
            >
              <span style={{ fontSize: 20, cursor: 'grab' }}>⋮⋮</span>
              <input type="color" value={c.color} onChange={e => updateColColor(c.id, e.target.value)} style={{ width: 28, height: 28, borderRadius: 5, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
              <span style={{ flex: 1, fontSize: 13 }}>{c.title}</span>
              {c.position === 0 && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#eef2ff', color: '#4338ca', fontWeight: 500 }}>Par défaut</span>}
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{c._count?.deals ?? 0} affaires</span>
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
