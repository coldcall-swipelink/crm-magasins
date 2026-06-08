'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { S } from '@/lib/styles';
import type { MapDeal } from './DealsMap';

// Leaflet manipule `window` → chargement client uniquement (pas de SSR).
const DealsMap = dynamic(() => import('./DealsMap'), {
  ssr: false,
  loading: () => (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 14 }}>
      Chargement de la carte…
    </div>
  ),
});

const DEFAULT_COLOR = '#64748b';
const COL_NOT_INTERESTED = 'Pas intéressé';
const COL_DEMO = 'Démo prévue';

// Pastille de légende reprenant la tête de l'épingle (point coloré, ✓ vert ou croix rouge).
function LegendBadge({ kind }: { kind: 'active' | 'demo' | 'lost' }) {
  const base = '#6366f1';
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
      <circle cx="9" cy="9" r="8.5" fill={base} />
      <circle cx="9" cy="9" r="5.2" fill="#fff" />
      {kind === 'demo' && <path d="M6.2 9 l1.7 1.7 l3.6 -3.8" fill="none" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
      {kind === 'lost' && <path d="M6.8 6.8 L11.2 11.2 M11.2 6.8 L6.8 11.2" stroke="#dc2626" strokeWidth="1.8" strokeLinecap="round" />}
      {kind === 'active' && <circle cx="9" cy="9" r="2.1" fill={base} />}
    </svg>
  );
}

interface BrandEntry {
  name: string;
  color: string;
  count: number;
}

export default function MapView() {
  const [deals, setDeals] = useState<MapDeal[]>([]);
  const [unlocated, setUnlocated] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeBrand, setActiveBrand] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/map');
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || 'Erreur de chargement');
          setDeals([]);
          setUnlocated(0);
        } else {
          setDeals(data.deals || []);
          setUnlocated(data.unlocated || 0);
        }
      } catch {
        if (!cancelled) setError('Impossible de charger la carte');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Enseignes présentes (pour la légende et le filtre), triées par nombre de deals.
  const brands = useMemo<BrandEntry[]>(() => {
    const map = new Map<string, BrandEntry>();
    for (const d of deals) {
      const name = d.brandName || 'Sans enseigne';
      const color = d.brandColor || DEFAULT_COLOR;
      const entry = map.get(name) || { name, color, count: 0 };
      entry.count += 1;
      map.set(name, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [deals]);

  const visibleDeals = useMemo(
    () => (activeBrand ? deals.filter((d) => (d.brandName || 'Sans enseigne') === activeBrand) : deals),
    [deals, activeBrand],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={S.pageHeader}>
        <span style={S.pageTitle}>🗺️ Carte des deals</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          Pipeline « Prospection »
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {loading ? 'Chargement…' : `${deals.length} deal${deals.length > 1 ? 's' : ''} localisé${deals.length > 1 ? 's' : ''}`}
          {unlocated > 0 && !loading && (
            <span style={{ color: '#d97706' }}> · {unlocated} sans localisation</span>
          )}
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Carte */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          {error ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626', fontSize: 14 }}>
              {error}
            </div>
          ) : (
            <DealsMap deals={visibleDeals} />
          )}
        </div>

        {/* Légende / filtre */}
        <aside
          style={{
            width: 240,
            flexShrink: 0,
            borderLeft: '1px solid #e2e8f0',
            background: '#fff',
            padding: '14px 16px',
            overflowY: 'auto',
          }}
        >
          <div style={S.sectionLabel}>Enseignes</div>
          {brands.length === 0 && !loading && (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Aucun deal localisé.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {brands.map((b) => {
              const active = activeBrand === b.name;
              return (
                <button
                  key={b.name}
                  onClick={() => setActiveBrand(active ? null : b.name)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 7,
                    border: '1px solid',
                    borderColor: active ? '#c7d2fe' : 'transparent',
                    background: active ? '#eef2ff' : 'transparent',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: '#334155',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: b.color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {b.name}
                  </span>
                  <span style={{ color: '#94a3b8', fontWeight: 600 }}>{b.count}</span>
                </button>
              );
            })}
          </div>
          {activeBrand && (
            <button
              onClick={() => setActiveBrand(null)}
              style={{ ...S.btnDefault, ...S.btnSm, marginTop: 8, width: '100%', justifyContent: 'center' }}
            >
              Tout afficher
            </button>
          )}

          <div style={{ ...S.sectionLabel, marginTop: 20 }}>Étapes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, color: '#475569' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <LegendBadge kind="active" />
              <span>En cours — point coloré</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <LegendBadge kind="demo" />
              <span>« {COL_DEMO} » — ✓ vert</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <LegendBadge kind="lost" />
              <span>« {COL_NOT_INTERESTED} » — croix rouge</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
