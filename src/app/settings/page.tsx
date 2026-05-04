'use client';
import { useEffect, useState, useCallback } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import type { Brand, PipelineColumn } from '@/types';
import { toast } from '@/components/ui/Toast';

const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: 13, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 };
const btnDef: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnXs: React.CSSProperties = { padding: '3px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', cursor: 'pointer', fontSize: 11 };

export default function SettingsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [columns, setColumns] = useState<PipelineColumn[]>([]);
  const [newBrand, setNewBrand] = useState({ name: '', color: '#6366f1' });
  const [editBrand, setEditBrand] = useState<Brand | null>(null);
  const [newColTitle, setNewColTitle] = useState('');
  const [newColColor, setNewColColor] = useState('#6366f1');

  const fetchAll = useCallback(async () => {
    const [bRes, cRes] = await Promise.all([fetch('/api/brands'), fetch('/api/columns')]);
    if (bRes.ok) setBrands(await bRes.json());
    if (cRes.ok) setColumns(await cRes.json());
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

  const row = { display: 'flex', alignItems: 'center', gap: 8, background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', padding: '8px 12px', marginBottom: 6 } as React.CSSProperties;

  return (
    <AppLayout>
      <div style={{ padding: '24px', maxWidth: 700 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Paramètres</div>

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
          <p style={{ fontSize: 12, color: '#b91c1c', marginBottom: 10 }}>Supprime toutes les affaires, offres et imports. Enseignes et colonnes conservées.</p>
          <button style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontWeight: 500, cursor: 'pointer', fontSize: 13 }} onClick={() => toast('Pour réinitialiser, lancez : npx prisma migrate reset', 'error')}>⚠ Réinitialiser</button>
        </div>
      </div>
    </AppLayout>
  );
}
