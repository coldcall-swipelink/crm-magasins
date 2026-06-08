'use client';

// src/app/dev/demo-drag/page.tsx
//
// Page de DÉMO (dev) : permet de glisser une carte « deal » fictive dans la
// colonne « Démo prévue » et de déclencher le MÊME code de provisioning
// Supabase que la vraie feature (createDemoOrganizationRecords via
// /api/dev/test-provisioning), SANS aucune dépendance à la base Neon du CRM.
//
// Prérequis (variables d'env sur le déploiement) :
//   NEXT_PUBLIC_BYPASS_USER_GATE = true   (sauter l'écran de connexion)
//   ENABLE_DEV_TEST_ROUTES       = true   (activer l'API de test)
//   SUPABASE_PRODUCT_URL / SUPABASE_PRODUCT_SERVICE_ROLE_KEY
//
// ⚠️ Page de test uniquement — ne pas exposer en production.

import { useState } from 'react';

interface FakeDeal {
  brandName: string;
  storeName: string;
  city: string;
  contactEmail: string;
  phoneNumber: string;
  siret: string;
}

const INITIAL: FakeDeal = {
  brandName: 'Carrefour',
  storeName: 'Carrefour Market',
  city: 'Lyon',
  contactEmail: 'contact@exemple.fr',
  phoneNumber: '0102030405',
  siret: '12345678900011',
};

export default function DemoDragPage() {
  const [deal, setDeal] = useState<FakeDeal>(INITIAL);
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [result, setResult] = useState<unknown>(null);
  const [moved, setMoved] = useState(false);

  const orgName = `${deal.brandName.trim() || deal.storeName.trim()}${deal.city.trim() ? ` — ${deal.city.trim()}` : ''}`;

  const handleDrop = async () => {
    setOver(false);
    setMoved(true);
    setStatus('loading');
    setResult(null);
    try {
      const res = await fetch('/api/dev/test-provisioning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deal),
      });
      const json = await res.json();
      setResult(json);
      setStatus(res.ok && json.ok ? 'ok' : 'error');
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
      setStatus('error');
    }
  };

  const reset = () => {
    setMoved(false);
    setStatus('idle');
    setResult(null);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', padding: 32, fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Démo — Glisser un deal en « Démo prévue »</h1>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>
          Page de test (sans base Neon). Glisse la carte dans la colonne « Démo prévue » pour créer
          <b> Organization + Organization_to_plan + Recruiter</b> dans Supabase staging.
        </p>
        <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 24 }}>
          Organization qui sera créée : <b>{orgName}</b>
        </p>

        {/* Champs éditables du deal fictif */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 10 }}>Données du deal fictif</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {(Object.keys(INITIAL) as (keyof FakeDeal)[]).map((k) => (
              <label key={k} style={{ fontSize: 11, color: '#64748b' }}>
                {k}
                <input
                  value={deal[k]}
                  onChange={(e) => setDeal({ ...deal, [k]: e.target.value })}
                  style={{ width: '100%', padding: '7px 9px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 13, marginTop: 4, boxSizing: 'border-box' }}
                />
              </label>
            ))}
          </div>
        </div>

        {/* Mini-kanban : carte draggable + colonne cible */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          {/* Colonne source */}
          <div style={{ flex: 1, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, minHeight: 160 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, color: '#475569' }}>À contacter</div>
            {!moved && (
              <div
                draggable
                onDragStart={() => setDragging(true)}
                onDragEnd={() => setDragging(false)}
                style={{
                  background: '#fff', border: '1px solid #e2e8f0', borderLeft: '4px solid #6366f1',
                  borderRadius: 10, padding: 12, cursor: 'grab', boxShadow: '0 1px 3px rgba(0,0,0,.08)',
                  opacity: dragging ? 0.4 : 1,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 14 }}>{deal.storeName || 'Magasin'}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{deal.brandName} · {deal.city}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{deal.contactEmail}</div>
              </div>
            )}
            {moved && <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>Deal déplacé →</div>}
          </div>

          {/* Colonne « Démo prévue » */}
          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={handleDrop}
            style={{
              flex: 1, background: over ? '#eef2ff' : '#fff',
              border: `2px dashed ${over ? '#6366f1' : '#cbd5e1'}`,
              borderRadius: 12, padding: 12, minHeight: 160, transition: 'all .15s',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, color: '#6366f1' }}>Démo prévue</div>
            {!moved && <div style={{ fontSize: 12, color: '#94a3b8' }}>Dépose la carte ici…</div>}
            {moved && (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderLeft: '4px solid #22c55e', borderRadius: 10, padding: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{deal.storeName}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{deal.brandName} · {deal.city}</div>
              </div>
            )}
          </div>
        </div>

        {/* Résultat */}
        {status !== 'idle' && (
          <div style={{ marginTop: 24 }}>
            {status === 'loading' && <div style={{ fontSize: 14, color: '#6366f1' }}>⏳ Création dans Supabase…</div>}
            {status === 'ok' && <div style={{ fontSize: 15, fontWeight: 700, color: '#16a34a' }}>✅ Organization + plan + Recruiter créés dans Supabase staging !</div>}
            {status === 'error' && <div style={{ fontSize: 15, fontWeight: 700, color: '#dc2626' }}>❌ Échec — voir le détail ci-dessous</div>}
            <pre style={{ marginTop: 12, background: '#0f172a', color: '#e2e8f0', padding: 16, borderRadius: 10, fontSize: 12, overflowX: 'auto' }}>
              {JSON.stringify(result, null, 2)}
            </pre>
            <button
              onClick={reset}
              style={{ marginTop: 12, padding: '8px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
            >
              ↺ Recommencer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
