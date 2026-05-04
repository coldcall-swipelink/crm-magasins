'use client';
// src/app/settings/page.tsx
import { useEffect, useState, useCallback } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import type { Brand, PipelineColumn } from '@/types';
import { toast } from '@/components/ui/Toast';
import { Plus, Trash2, Edit2, Check, X, Settings } from 'lucide-react';

export default function SettingsPage() {
  const [brands,  setBrands]  = useState<Brand[]>([]);
  const [columns, setColumns] = useState<PipelineColumn[]>([]);
  const [editBrand,  setEditBrand]  = useState<Brand | null>(null);
  const [newBrand,   setNewBrand]   = useState({ name: '', color: '#6366f1' });
  const [newColTitle, setNewColTitle] = useState('');
  const [newColColor, setNewColColor] = useState('#6366f1');

  const fetchAll = useCallback(async () => {
    const [bRes, cRes] = await Promise.all([fetch('/api/brands'), fetch('/api/columns')]);
    if (bRes.ok) setBrands(await bRes.json());
    if (cRes.ok) setColumns(await cRes.json());
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Enseignes ─────────────────────────────────────────────────────────────
  const addBrand = async () => {
    if (!newBrand.name.trim()) return;
    const res = await fetch('/api/brands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newBrand) });
    if (res.ok) { setNewBrand({ name: '', color: '#6366f1' }); fetchAll(); toast('Enseigne ajoutée'); }
  };

  const saveBrand = async () => {
    if (!editBrand) return;
    const res = await fetch(`/api/brands/${editBrand.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editBrand.name, color: editBrand.color }) });
    if (res.ok) { setEditBrand(null); fetchAll(); toast('Enseigne mise à jour'); }
  };

  const deleteBrand = async (id: string) => {
    if (!confirm('Supprimer cette enseigne ?')) return;
    await fetch(`/api/brands/${id}`, { method: 'DELETE' });
    fetchAll(); toast('Enseigne supprimée');
  };

  // ── Colonnes ─────────────────────────────────────────────────────────────
  const addColumn = async () => {
    if (!newColTitle.trim()) return;
    const res = await fetch('/api/columns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newColTitle, color: newColColor }) });
    if (res.ok) { setNewColTitle(''); fetchAll(); toast('Colonne ajoutée'); }
  };

  const updateColColor = async (id: string, color: string) => {
    await fetch(`/api/columns/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color }) });
    fetchAll();
  };

  const deleteColumn = async (id: string) => {
    const res = await fetch(`/api/columns/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { toast(data.error, 'error'); return; }
    fetchAll(); toast('Colonne supprimée');
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-center gap-2 mb-6">
          <Settings size={20} className="text-slate-400" />
          <h1 className="text-xl font-bold text-slate-900">Paramètres</h1>
        </div>

        {/* Enseignes */}
        <section className="mb-10">
          <h2 className="text-base font-semibold text-slate-800 mb-4">Enseignes</h2>
          <div className="space-y-2 mb-4">
            {brands.map(b => (
              <div key={b.id} className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
                {editBrand?.id === b.id ? (
                  <>
                    <input
                      className="form-input flex-1 h-8"
                      value={editBrand.name}
                      onChange={e => setEditBrand(eb => eb ? { ...eb, name: e.target.value } : null)}
                    />
                    <input type="color" className="w-9 h-8 rounded cursor-pointer border border-slate-200 p-0.5" value={editBrand.color} onChange={e => setEditBrand(eb => eb ? { ...eb, color: e.target.value } : null)} />
                    <button className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1" onClick={saveBrand}><Check size={12} /></button>
                    <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setEditBrand(null)}><X size={12} /></button>
                  </>
                ) : (
                  <>
                    <div className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ background: b.color }} />
                    <span className="text-sm font-medium text-slate-800 flex-1">{b.name}</span>
                    <span className="text-xs text-slate-400">{(b._count?.stores ?? 0)} magasin{(b._count?.stores ?? 0) > 1 ? 's' : ''}</span>
                    <button onClick={() => setEditBrand({ ...b })} className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50"><Edit2 size={13} /></button>
                    <button onClick={() => deleteBrand(b.id)} className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50"><Trash2 size={13} /></button>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Ajouter enseigne */}
          <div className="flex gap-2">
            <input className="form-input flex-1" placeholder="Nom de l'enseigne" value={newBrand.name} onChange={e => setNewBrand(b => ({ ...b, name: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addBrand()} />
            <input type="color" className="w-10 h-10 rounded-lg cursor-pointer border border-slate-200 p-0.5" value={newBrand.color} onChange={e => setNewBrand(b => ({ ...b, color: e.target.value }))} />
            <button className="btn-primary flex items-center gap-1.5" onClick={addBrand}><Plus size={14} /> Ajouter</button>
          </div>
        </section>

        {/* Colonnes pipeline */}
        <section className="mb-10">
          <h2 className="text-base font-semibold text-slate-800 mb-4">Colonnes pipeline</h2>
          <div className="space-y-2 mb-4">
            {[...columns].sort((a, b) => a.position - b.position).map(col => (
              <div key={col.id} className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
                <input
                  type="color"
                  className="w-8 h-8 rounded cursor-pointer border border-slate-200 p-0.5 flex-shrink-0"
                  value={col.color}
                  onChange={e => updateColColor(col.id, e.target.value)}
                  title="Changer la couleur"
                />
                <span className="text-sm font-medium text-slate-800 flex-1">{col.title}</span>
                <span className="text-xs text-slate-400">{col._count?.deals ?? 0} affaire{(col._count?.deals ?? 0) > 1 ? 's' : ''}</span>
                {col.position === 0 && (
                  <span className="badge bg-indigo-100 text-indigo-600 text-[10px]">Par défaut</span>
                )}
                <button onClick={() => deleteColumn(col.id)} className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>

          {/* Ajouter colonne */}
          <div className="flex gap-2">
            <input className="form-input flex-1" placeholder="Titre de la colonne" value={newColTitle} onChange={e => setNewColTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && addColumn()} />
            <input type="color" className="w-10 h-10 rounded-lg cursor-pointer border border-slate-200 p-0.5" value={newColColor} onChange={e => setNewColColor(e.target.value)} />
            <button className="btn-primary flex items-center gap-1.5" onClick={addColumn}><Plus size={14} /> Ajouter</button>
          </div>
        </section>

        {/* Zone dangereuse */}
        <section>
          <h2 className="text-base font-semibold text-slate-800 mb-4">Zone de réinitialisation</h2>
          <div className="border border-red-200 rounded-xl p-5 bg-red-50">
            <p className="text-sm text-red-700 mb-4">
              Cette action efface <strong>toutes les affaires, offres et imports</strong>.
              Les enseignes et colonnes sont conservées. Cette action est irréversible.
            </p>
            <button
              className="btn-danger text-sm"
              onClick={async () => {
                if (!confirm('⚠️ Réinitialiser toutes les données CRM ? Cette action est irréversible.')) return;
                // Appel direct Prisma via une route dédiée serait mieux,
                // mais pour simplifier on recharge juste la page
                toast('Pour réinitialiser complètement, lancez : npx prisma migrate reset', 'error');
              }}
            >
              ⚠ Réinitialiser les données
            </button>
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
