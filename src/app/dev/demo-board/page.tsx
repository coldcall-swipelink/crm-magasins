'use client';

// src/app/dev/demo-board/page.tsx
//
// Board de DÉMO fidèle au vrai CRM (pipeline « Prospection »), mais alimenté
// par des données FICTIVES en mémoire — aucune dépendance à la base Neon.
//
// Reproduit le rendu de PipelineBoard + DealCard. Glisser une carte dans la
// colonne « Démo prévue » déclenche le MÊME provisioning Supabase que la vraie
// feature (via /api/dev/test-provisioning) : Organization + plan + Recruiter.
//
// Prérequis : ENABLE_DEV_TEST_ROUTES=true + SUPABASE_PRODUCT_* sur le
// déploiement. La route /dev/* saute automatiquement l'écran de connexion.
//
// ⚠️ Page de test uniquement — ne pas exposer en production.

import { useState, useRef } from 'react';

// Colonnes du pipeline « Prospection » (identiques au seed / à la prod).
const COLUMNS = [
  { id: 'c1', title: 'À appeler', color: '#6366f1' },
  { id: 'c2', title: 'Contacté', color: '#8b5cf6' },
  { id: 'c3', title: 'Email envoyé', color: '#0ea5e9' },
  { id: 'c4', title: 'Relance prévue', color: '#f59e0b' },
  { id: 'c5', title: 'Intéressé', color: '#22c55e' },
  { id: 'c6', title: 'Démo prévue', color: '#10b981' },
  { id: 'c7', title: 'Client', color: '#84cc16' },
  { id: 'c8', title: 'Pas intéressé', color: '#64748b' },
];

const DEMO_COLUMN_TITLE = 'Démo prévue';

interface DemoDeal {
  id: string;
  columnId: string;
  brandName: string;
  storeName: string;
  city: string;
  department: string;
  priority: string;
  contactCalling: string;
  contactEmail: string;
  siret: string;
  offers: string[];
}

const INITIAL_DEALS: DemoDeal[] = [
  { id: 'd1', columnId: 'c2', brandName: 'Intermarché', storeName: 'Intermarché Nantes Sud', city: 'Nantes', department: '44', priority: 'élevée', contactCalling: '02 40 11 22 33', contactEmail: 'rh.nantes@intermarche.fr', siret: '11122233300011', offers: ['Boucher', 'Responsable Boucherie'] },
  { id: 'd2', columnId: 'c3', brandName: 'Leclerc', storeName: 'E.Leclerc Rennes', city: 'Rennes', department: '35', priority: 'normale', contactCalling: '02 99 44 55 66', contactEmail: 'recrutement@leclerc-rennes.fr', siret: '22233344400022', offers: ['Manager Rayon'] },
  { id: 'd3', columnId: 'c1', brandName: 'Super U', storeName: 'Super U Bordeaux', city: 'Bordeaux', department: '33', priority: 'normale', contactCalling: '05 56 77 88 99', contactEmail: 'contact@superu-bordeaux.fr', siret: '33344455500033', offers: ['Caissier'] },
  { id: 'd4', columnId: 'c5', brandName: 'Carrefour', storeName: 'Carrefour Market Lyon 7', city: 'Lyon', department: '69', priority: 'élevée', contactCalling: '04 72 33 44 55', contactEmail: 'rh@carrefour-lyon7.fr', siret: '44455566600044', offers: ['Employé libre service', 'Chef de caisse'] },
  { id: 'd5', columnId: 'c4', brandName: 'Aldi', storeName: 'Aldi Marseille Centre', city: 'Marseille', department: '13', priority: 'faible', contactCalling: '04 91 22 33 44', contactEmail: 'rh@aldi-marseille.fr', siret: '55566677700055', offers: ['Employé commercial'] },
  { id: 'd6', columnId: 'c1', brandName: 'Intermarché', storeName: 'Intermarché Lille Nord', city: 'Lille', department: '59', priority: 'urgente', contactCalling: '03 20 55 66 77', contactEmail: 'direction@intermarche-lille.fr', siret: '66677788800066', offers: ['Directeur'] },
];

function getBrandBorderColor(brandName?: string): string {
  if (!brandName) return '#6366f1';
  const n = brandName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (n.includes('leclerc')) return '#2563eb';
  if (n.includes('super u') || n === 'u') return '#2563eb';
  if (n.includes('intermarche')) return '#e11d48';
  let h = 0;
  for (let i = 0; i < brandName.length; i++) h = (Math.imul(31, h) + brandName.charCodeAt(i)) | 0;
  return '#' + Math.abs(h).toString(16).slice(0, 6).padEnd(6, '0');
}

const PRIORITY_STYLE: Record<string, { bg: string; fg: string }> = {
  urgente: { bg: '#fee2e2', fg: '#b91c1c' },
  élevée: { bg: '#ffedd5', fg: '#c2410c' },
  normale: { bg: '#e0e7ff', fg: '#4338ca' },
  faible: { bg: '#f1f5f9', fg: '#64748b' },
};

type ProvStatus = { state: 'loading' | 'ok' | 'error'; dealId: string; message: string; data?: unknown };

export default function DemoBoardPage() {
  const [deals, setDeals] = useState<DemoDeal[]>(INITIAL_DEALS);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [prov, setProv] = useState<ProvStatus | null>(null);
  const dragDeal = useRef<DemoDeal | null>(null);

  const triggerProvisioning = async (deal: DemoDeal) => {
    setProv({ state: 'loading', dealId: deal.id, message: `Création dans Supabase pour « ${deal.brandName} — ${deal.city} »…` });
    try {
      const res = await fetch('/api/dev/test-provisioning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName: deal.brandName,
          storeName: deal.storeName,
          city: deal.city,
          contactEmail: deal.contactEmail,
          phoneNumber: deal.contactCalling.replace(/\s/g, ''),
          siret: deal.siret,
        }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setProv({ state: 'ok', dealId: deal.id, message: `✅ Organization « ${json.result?.organizationName} » + plan + Recruiter créés dans Supabase staging.`, data: json });
      } else {
        setProv({ state: 'error', dealId: deal.id, message: '❌ Échec du provisioning Supabase.', data: json });
      }
    } catch (e) {
      setProv({ state: 'error', dealId: deal.id, message: '❌ Erreur réseau.', data: { error: e instanceof Error ? e.message : String(e) } });
    }
  };

  const onDrop = (targetColId: string) => {
    const deal = dragDeal.current;
    setDraggingId(null);
    setDragOverCol(null);
    if (!deal || deal.columnId === targetColId) return;
    setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, columnId: targetColId } : d)));
    const targetCol = COLUMNS.find((c) => c.id === targetColId);
    if (targetCol?.title === DEMO_COLUMN_TITLE) {
      triggerProvisioning({ ...deal, columnId: targetColId });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      {/* Barre du haut (comme PipelineBoard) */}
      <div style={{ padding: '8px 16px', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, marginRight: 4 }}>Pipeline</span>
        <span style={{ padding: '4px 8px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', fontSize: 12, color: '#475569' }}>Prospection</span>
        <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600, marginLeft: 8 }}>● Démo (données fictives, sans Neon)</span>
        <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>{deals.length} affaires</span>
      </div>

      {/* Bandeau de résultat du provisioning */}
      {prov && (
        <div style={{
          padding: '10px 16px', fontSize: 13, flexShrink: 0,
          background: prov.state === 'ok' ? '#f0fdf4' : prov.state === 'error' ? '#fef2f2' : '#eef2ff',
          color: prov.state === 'ok' ? '#166534' : prov.state === 'error' ? '#b91c1c' : '#4338ca',
          borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontWeight: 600 }}>{prov.state === 'loading' ? '⏳ ' : ''}{prov.message}</span>
          {prov.data != null && prov.state !== 'loading' && (
            <details style={{ marginLeft: 'auto' }}>
              <summary style={{ cursor: 'pointer', fontSize: 11, color: '#64748b' }}>Voir le JSON</summary>
              <pre style={{ margin: '6px 0 0', fontSize: 11, maxWidth: 600, overflowX: 'auto' }}>{JSON.stringify(prov.data, null, 2)}</pre>
            </details>
          )}
        </div>
      )}

      {/* Colonnes */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {COLUMNS.map((col) => {
          const colDeals = deals.filter((d) => d.columnId === col.id);
          const isDemo = col.title === DEMO_COLUMN_TITLE;
          return (
            <div
              key={col.id}
              onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.id); }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={() => onDrop(col.id)}
              style={{
                background: dragOverCol === col.id ? '#eef2ff' : '#f1f5f9', borderRadius: 10,
                width: 230, flexShrink: 0, display: 'flex', flexDirection: 'column',
                border: `1px solid ${dragOverCol === col.id ? '#6366f1' : isDemo ? '#10b981' : '#e2e8f0'}`,
                maxHeight: 'calc(100vh - 160px)',
                outline: dragOverCol === col.id ? '2px dashed #6366f1' : 'none',
              }}
            >
              <div style={{ padding: '8px 10px 6px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: 11, flex: 1, color: '#374151' }}>{col.title}{isDemo ? ' 🎯' : ''}</span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{colDeals.length}</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 5, minHeight: 50 }}>
                {colDeals.map((deal) => {
                  const borderColor = getBrandBorderColor(deal.brandName);
                  const pr = PRIORITY_STYLE[deal.priority] || PRIORITY_STYLE.normale;
                  return (
                    <div
                      key={deal.id}
                      draggable
                      onDragStart={() => { dragDeal.current = deal; setDraggingId(deal.id); }}
                      onDragEnd={() => { setDraggingId(null); setDragOverCol(null); }}
                      style={{
                        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9, padding: '9px 11px',
                        cursor: 'grab', userSelect: 'none', borderLeft: `4px solid ${borderColor}`,
                        opacity: draggingId === deal.id ? 0.5 : 1, boxShadow: '0 1px 3px rgba(0,0,0,.06)',
                      }}
                    >
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: borderColor, marginBottom: 1 }}>{deal.brandName}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{deal.storeName}</div>
                      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>📍 {deal.city} ({deal.department})</div>
                      <div style={{ fontSize: 10, color: '#4f46e5', marginTop: 2, fontWeight: 500 }}>📞 {deal.contactCalling}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <span style={{ background: pr.bg, color: pr.fg, fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4 }}>{deal.priority}</span>
                        <span style={{ fontSize: 10, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>💼 {deal.offers.join(' · ')}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: '6px 16px', fontSize: 11, color: '#94a3b8', borderTop: '1px solid #e2e8f0', flexShrink: 0 }}>
        Astuce : glisse n'importe quelle carte dans la colonne <b>« Démo prévue 🎯 »</b> pour créer l'Organization + le plan + le Recruiter dans Supabase staging.
      </div>
    </div>
  );
}
