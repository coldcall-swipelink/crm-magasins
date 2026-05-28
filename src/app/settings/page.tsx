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

const VARIABLES = ['{{civilite}}', '{{enseigne}}', '{{nom_magasin}}', '{{ville}}', '{{directeur}}', '{{contact_calling}}', '{{poste}}', '{{prenom_expediteur}}'];

export default function SettingsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [columns, setColumns] = useState<PipelineColumn[]>([]);
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

  const fetchAll = useCallback(async () => {
    const [bRes, cRes, collRes, tRes] = await Promise.all([
      fetch('/api/brands'), fetch('/api/columns'),
      fetch('/api/collaborators'), fetch('/api/email-templates'),
    ]);
    if (bRes.ok) setBrands(await bRes.json());
    if (cRes.ok) setColumns(await cRes.json());
    if (collRes.ok) setCollaborators(await collRes.json());
    if (tRes.ok) setTemplates(await tRes.json());
  }, []);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const addBrand = async () => {
    if (!newBrand.name.trim()) return;
    await fetch('/api/brands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newBrand) });
    setNewBrand({ name: '', color: '#6366f1' }); fetchAll(); toast('Enseigne ajoutée');
  };
  const saveBrand = async () => {
    if (!editBrand) return;
    await fetch(`/api/brands/${editBrand.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editBrand.name, color: editBrand.color }) });
    setEditBrand(null); fetchAll(); toast('Enseigne mise à jour');
  };
  const deleteBrand = async (id: string) => {
    if (!confirm('Supprimer cette enseigne ?')) return;
    await fetch(`/api/brands/${id}`, { method: 'DELETE' }); fetchAll(); toast('Supprimée');
  };
  const addColumn = async () => {
    if (!newColTitle.trim()) return;
    await fetch('/api/columns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newColTitle, color: newColColor }) });
    setNewColTitle(''); fetchAll(); toast('Colonne ajoutée');
  };
  const deleteColumn = async (id: string) => {
    const res = await fetch(`/api/columns/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { toast(data.error, 'error'); return; }
    fetchAll(); toast('Colonne supprimée');
  };
  const updateColColor = async (id: string, color: string) => {
    await fetch(`/api/columns/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color }) });
  };
  const addCollab = async () => {
    if (!newCollab.name.trim()) return;
    await fetch('/api/collaborators', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newCollab) });
    setNewCollab({ name: '', email: '', color: '#6366f1' }); fetchAll(); toast('Collaborateur ajouté');
  };
  const saveCollab = async () => {
    if (!editCollab) return;
    await fetch(`/api/collaborators/${editCollab.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editCollab.name, email: editCollab.email, color: editCollab.color }) });
    setEditCollab(null); fetchAll(); toast('Collaborateur mis à jour');
  };
  const deleteCollab = async (id: string) => {
    if (!confirm('Supprimer ce collaborateur ?')) return;
    await fetch(`/api/collaborators/${id}`, { method: 'DELETE' }); fetchAll(); toast('Supprimé');
  };
  const addTemplate = async () => {
    if (!newTemplate.name.trim()) return;
    await fetch('/api/email-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newTemplate) });
    setNewTemplate({ name: '', subject: '', body: '' }); setShowNewTemplate(false); fetchAll(); toast('Template ajouté');
  };
  const saveTemplate = async () => {
    if (!editTemplate) return;
    await fetch(`/api/email-templates/${editTemplate.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editTemplate) });
    setEditTemplate(null); fetchAll(); toast('Template mis à jour');
  };
  const deleteTemplate = async (id: string) => {
    if (!confirm('Supprimer ce template ?')) return;
    await fetch(`/api/email-templates/${id}`, { method: 'DELETE' }); fetchAll(); toast('Supprimé');
  };

  const insertVar = (v: string, field: 'subject' | 'body', isEdit: boolean) => {
    if (isEdit && editTemplate) setEditTemplate(t => t ? { ...t, [field]: (t[field] || '') + v } : null);
    else setNewTemplate(t => ({ ...t, [field]: (t[field] || '') + v }));
  };

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', padding: '8px 12px', marginBottom: 6 };

  const TemplateForm = ({ t, isEdit }: { t: EmailTemplate | typeof newTemplate, isEdit: boolean }) => (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 10 }}>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3 }}>Nom du template</label>
        <input style={inp} placeholder="Ex: Première prise de contact" value={t.name}
          onChange={e => isEdit ? setEditTemplate(x => x ? { ...x, name: e.target.value } : null) : setNewTemplate(x => ({ ...x, name: e.target.value }))} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3 }}>Sujet</label>
        <input style={inp} placeholder="Ex: Votre offre d'emploi - {{enseigne}} {{nom_magasin}}" value={t.subject}
          onChange={e => isEdit ? setEditTemplate(x => x ? { ...x, subject: e.target.value } : null) : setNewTemplate(x => ({ ...x, subject: e.target.value }))} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3 }}>Corps du message</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {VARIABLES.map(v => (
            <button key={v} onClick={() => insertVar(v, 'body', isEdit)}
              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: '1px solid #c7d2fe', background: '#eef2ff', color: '#4338ca', cursor: 'pointer' }}>
              {v}
            </button>
          ))}
        </div>
        <textarea style={{ ...inp, height: 160, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
          placeholder="Bonjour {{civilite}},&#10;&#10;Je me permets de vous contacter concernant votre offre..."
          value={t.body}
          onChange={e => isEdit ? setEditTemplate(x => x ? { ...x, body: e.target.value } : null) : setNewTemplate(x => ({ ...x, body: e.target.value }))} />
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
        Variables disponibles : {VARIABLES.join(' ')}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={btnPri} onClick={isEdit ? saveTemplate : addTemplate}>Enregistrer</button>
        <button style={btnDef} onClick={() => isEdit ? setEditTemplate(null) : setShowNewTemplate(false)}>Annuler</button>
      </div>
    </div>
  );

  return (
    <AppLayout>
      <div style={{ padding: '24px', maxWidth: 700 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Paramètres</div>

        {/* Templates email */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Templates email</div>
            <button style={{ ...btnPri, padding: '4px 10px', fontSize: 12 }} onClick={() => setShowNewTemplate(true)}>+ Nouveau</button>
          </div>
          {showNewTemplate && <TemplateForm t={newTemplate} isEdit={false} />}
          {templates.map(t => editTemplate?.id === t.id ? (
            <TemplateForm key={t.id} t={editTemplate} isEdit={true} />
          ) : (
            <div key={t.id} style={row}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>📧 {t.name}</div>
                {t.subject && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{t.subject.slice(0, 60)}{t.subject.length > 60 ? '…' : ''}</div>}
              </div>
              <button style={btnXs} onClick={() => setEditTemplate({ ...t })}>✎</button>
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

        {/* Colonnes */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Colonnes pipeline</div>
          {[...columns].sort((a, b) => a.position - b.position).map(c => (
            <div key={c.id} style={row}>
              <input type="color" value={c.color} onChange={e => updateColColor(c.id, e.target.value)} style={{ width: 28, height: 28, borderRadius: 5, border: '1px solid #e2e8f0', cursor: 'pointer' }} />
              <span style={{ flex: 1, fontSize: 13 }}>{c.title}</span>
              {c.position === 0 && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#eef2ff', color: '#4338ca', fontWeight: 500 }}>Par défaut</span>}
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{c._count?.deals ?? 0} affaires</span>
              <button style={btnXs} onClick={() => deleteColumn(c.id)}>🗑</button>
            </div>
          ))}
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
