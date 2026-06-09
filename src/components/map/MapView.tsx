'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import DealDrawer from '@/components/deal/DealDrawer';
import { dotHtml, displayColor, type MapDeal } from './DealsMap';

// Leaflet manipule `window` → chargement client uniquement (pas de SSR).
const DealsMap = dynamic(() => import('./DealsMap'), {
  ssr: false,
  loading: () => (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 14 }}>
      Chargement de la carte…
    </div>
  ),
});

function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/** Convertit une couleur hex en rgba avec alpha (fond teint\u00e9 des chips actives). */
function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return `rgba(99,102,241,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

interface BrandEntry {
  name: string;
  color: string;
  count: number;
}

type Focus = { lat: number; lng: number; key: number };

export default function MapView() {
  const [deals, setDeals] = useState<MapDeal[]>([]);
  const [unlocated, setUnlocated] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<Focus | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
          setError(data.detail || data.error || 'Erreur de chargement');
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
  }, [reloadKey]);

  // Enseignes présentes (légende + filtre), triées par nombre de deals.
  const brands = useMemo<BrandEntry[]>(() => {
    const map = new Map<string, BrandEntry>();
    for (const d of deals) {
      const name = d.brandName || 'Sans enseigne';
      const color = displayColor(d.brandColor);
      const entry = map.get(name) || { name, color, count: 0 };
      entry.count += 1;
      map.set(name, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [deals]);

  const toggleBrand = (name: string) =>
    setSelectedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  // Filtrage par recherche (enseigne ou ville) et par enseignes sélectionnées.
  const visibleDeals = useMemo(() => {
    const q = norm(query);
    return deals.filter((d) => {
      if (selectedBrands.size && !selectedBrands.has(d.brandName || 'Sans enseigne')) return false;
      if (!q) return true;
      return (
        norm(d.brandName || '').includes(q) ||
        norm(d.storeName).includes(q) ||
        norm(d.city).includes(q)
      );
    });
  }, [deals, query, selectedBrands]);

  const dot = (deal: Pick<MapDeal, 'brandColor' | 'columnTitle'>, size = 14) => (
    <span
      style={{ display: 'inline-block', width: size, height: size, flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: dotHtml(deal, size) }}
    />
  );

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Sidebar gauche */}
      <aside
        style={{
          width: 300,
          flexShrink: 0,
          borderRight: '1px solid #e2e8f0',
          background: '#fff',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div style={{ padding: '16px 16px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e11d48', display: 'inline-block' }} />
            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Carte des deals</span>
          </div>
          <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>Pipeline « Prospection »</div>
        </div>

        {/* Recherche */}
        <div style={{ padding: '0 16px' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14 }}>🔍</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une enseigne ou une ville…"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px 10px 34px',
                borderRadius: 10,
                border: '1px solid #e2e8f0',
                background: '#f8fafc',
                fontSize: 13,
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Compteur + actualiser */}
        <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13 }}>
            <strong style={{ color: '#e11d48', fontWeight: 700 }}>{visibleDeals.length}</strong>{' '}
            <span style={{ color: '#64748b' }}>deal{visibleDeals.length > 1 ? 's' : ''}</span>
            {unlocated > 0 && <span style={{ color: '#d97706', fontSize: 11.5 }}> · {unlocated} sans loc.</span>}
          </span>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: '#64748b', fontSize: 12.5, cursor: loading ? 'default' : 'pointer', padding: 0 }}
          >
            <span style={{ display: 'inline-block', transform: loading ? 'rotate(360deg)' : 'none', transition: 'transform .6s' }}>↻</span>
            Actualiser
          </button>
        </div>

        {/* Filtre par enseigne (multi-sélection) */}
        <div style={{ padding: '4px 16px 10px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', letterSpacing: '.6px', textTransform: 'uppercase' }}>
              Filtrer par enseigne
            </span>
            {selectedBrands.size > 0 && (
              <button
                onClick={() => setSelectedBrands(new Set())}
                style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: 11.5, cursor: 'pointer', padding: 0 }}
              >
                Tout afficher
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {brands.map((b) => {
              const active = selectedBrands.has(b.name);
              return (
                <button
                  key={b.name}
                  onClick={() => toggleBrand(b.name)}
                  title={`${b.count} deal(s)`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12,
                    padding: '4px 9px', borderRadius: 999,
                    border: `1px solid ${active ? b.color : '#e2e8f0'}`,
                    background: active ? hexA(b.color, 0.14) : '#fff',
                    color: active ? '#0f172a' : '#475569', fontWeight: active ? 600 : 400,
                  }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: b.color, display: 'inline-block', flexShrink: 0 }} />
                  {b.name}
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>{b.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Liste des deals */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {error ? (
            <div style={{ padding: 16, fontSize: 12.5, color: '#b91c1c', whiteSpace: 'pre-wrap' }}>{error}</div>
          ) : visibleDeals.length === 0 && !loading ? (
            <div style={{ padding: 16, fontSize: 12.5, color: '#94a3b8' }}>Aucun deal.</div>
          ) : (
            visibleDeals.map((d) => (
              <button
                key={d.id}
                onClick={() => setFocus({ lat: d.latitude, lng: d.longitude, key: Date.now() })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  padding: '9px 16px', border: 'none', borderBottom: '1px solid #f1f5f9',
                  background: 'transparent', cursor: 'pointer',
                }}
              >
                {dot(d, 14)}
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.brandName || d.storeName}
                  </span>
                  <span style={{ display: 'block', fontSize: 11.5, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.city || d.storeName}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>

        {/* Légende des états */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 7, fontSize: 11.5, color: '#475569' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {dot({ brandColor: '#64748b', columnTitle: 'active' }, 13)}
            <span>En cours</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {dot({ brandColor: '#64748b', columnTitle: 'Démo prévue' }, 13)}
            <span>Démo prévue (anneau vert)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {dot({ brandColor: '#64748b', columnTitle: 'Pas intéressé' }, 13)}
            <span>Pas intéressé (creux)</span>
          </div>
        </div>
      </aside>

      {/* Carte */}
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <DealsMap deals={visibleDeals} focus={focus} onOpenDeal={setSelectedDealId} />
      </div>

      {/* Fiche détaillée du deal (ouverte au clic sur la bulle).
          Wrapper à z-index élevé : les couches Leaflet montent jusqu'à ~1000,
          le drawer (z-index 40 en interne) doit passer au-dessus. */}
      {selectedDealId && (
        <div style={{ position: 'relative', zIndex: 2000 }}>
          <DealDrawer
            dealId={selectedDealId}
            onClose={() => setSelectedDealId(null)}
            onUpdated={() => setReloadKey((k) => k + 1)}
          />
        </div>
      )}
    </div>
  );
}
