'use client';
import { useState, useEffect } from 'react';
import type { PipelineColumn, Brand } from '@/types';
import { toast } from '@/components/ui/Toast';

interface Props {
  columns: PipelineColumn[];
  onClose: () => void;
  onCreated: () => void;
}

const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #e9e9f1', background: '#f7f7fb', color: '#14152b', fontSize: 13, outline: 'none', marginBottom: 8 };

export default function CreateDealModal({ columns, onClose, onCreated }: Props) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    // Store
    brandId: '', storeName: '', city: '', department: '', address: '', siret: '',
    // Deal
    columnId: columns.find(c => c.position === 0)?.id || columns[0]?.id || '',
    priority: 'normale',
    // Contacts
    directeur: '', contactCalling: '', email: '',
  });

  useEffect(() => {
    fetch('/api/brands').then(r => r.json()).then(setBrands).catch(() => {});
  }, []);

  const sortedCols = [...columns].sort((a, b) => a.position - b.position);

  const handleSubmit = async () => {
    if (!form.storeName.trim()) { toast('Le nom du magasin est requis', 'error'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      toast('Affaire créée !');
      onCreated();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 24, width: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Créer une affaire manuellement</div>

        {/* Magasin */}
        <div style={{ fontSize: 11, fontWeight: 700, color: '#9a9cb5', letterSpacing: '.8px', textTransform: 'uppercase', marginBottom: 8 }}>MAGASIN</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 4 }}>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={{ fontSize: 11, color: '#6b6e89', display: 'block', marginBottom: 3 }}>Enseigne</label>
            <select style={inp} value={form.brandId} onChange={e => setForm(f => ({ ...f, brandId: e.target.value }))}>
              <option value="">— Sélectionner —</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={{ fontSize: 11, color: '#6b6e89', display: 'block', marginBottom: 3 }}>Nom du magasin *</label>
            <input style={inp} placeholder="Ex: Intermarché Nantes Sud" value={form.storeName} onChange={e => setForm(f => ({ ...f, storeName: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#6b6e89', display: 'block', marginBottom: 3 }}>Ville</label>
            <input style={inp} placeholder="Nantes" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#6b6e89', display: 'block', marginBottom: 3 }}>Département</label>
            <input style={inp} placeholder="44" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={{ fontSize: 11, color: '#6b6e89', display: 'block', marginBottom: 3 }}>Adresse</label>
            <input style={inp} placeholder="12 rue de la Paix" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          </div>
        </div>

        {/* Contacts */}
        <div style={{ fontSize: 11, fontWeight: 700, color: '#9a9cb5', letterSpacing: '.8px', textTransform: 'uppercase', marginBottom: 8, marginTop: 8 }}>CONTACTS</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 4 }}>
          <div>
            <label style={{ fontSize: 11, color: '#6b6e89', display: 'block', marginBottom: 3 }}>Directeur</label>
            <input style={inp} placeholder="Prénom Nom" value={form.directeur} onChange={e => setForm(f => ({ ...f, directeur: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#6b6e89', display: 'block', marginBottom: 3 }}>Contact calling</label>
            <input style={inp} placeholder="Prénom Nom" value={form.contactCalling} onChange={e => setForm(f => ({ ...f, contactCalling: e.target.value }))} />
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={{ fontSize: 11, color: '#6b6e89', display: 'block', marginBottom: 3 }}>Email</label>
            <input style={inp} type="email" placeholder="contact@magasin.fr" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
        </div>

        {/* CRM */}
        <div style={{ fontSize: 11, fontWeight: 700, color: '#9a9cb5', letterSpacing: '.8px', textTransform: 'uppercase', marginBottom: 8, marginTop: 8 }}>CRM</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 11, color: '#6b6e89', display: 'block', marginBottom: 3 }}>Colonne</label>
            <select style={inp} value={form.columnId} onChange={e => setForm(f => ({ ...f, columnId: e.target.value }))}>
              {sortedCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#6b6e89', display: 'block', marginBottom: 3 }}>Priorité</label>
            <select style={inp} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
              {['faible', 'normale', 'élevée', 'urgente'].map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#6d5ae6', color: '#fff', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .7 : 1 }}
          >
            {loading ? 'Création…' : 'Créer l\'affaire'}
          </button>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #e9e9f1', background: '#f3f3f9', color: '#334155', fontWeight: 500, fontSize: 14, cursor: 'pointer' }}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
