'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import DealDrawer from '@/components/deal/DealDrawer';
import {
  displayColor,
  isLocated,
  stageColor,
  type LocatedDeal,
  type MapDeal,
  type Zone,
} from './DealsMap';
import './map.css';

// Leaflet manipule `window` → chargement client uniquement (pas de SSR).
const DealsMap = dynamic(() => import('./DealsMap'), {
  ssr: false,
  loading: () => (
    <div className="slm-empty" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      Chargement de la carte…
    </div>
  ),
});

/* ── Onglets ────────────────────────────────────────────────────────────────
   « Clients »  : affaires signées (étape SMARTLINKÉ / Signé / Client).
   « PV »       : affaires taguées Prospection de Valeur sur la fiche affaire.
   « Tous »     : l'intégralité des pipelines Prospection & Closing.        */
type TabKey = 'tous' | 'clients' | 'pv';

const TABS: { key: TabKey; label: string; subtitle: string; noun: string; match: (d: MapDeal) => boolean }[] = [
  { key: 'tous', label: 'Tous', subtitle: 'Magasins suivis — Prospection & Closing', noun: 'magasin', match: () => true },
  { key: 'clients', label: 'Clients', subtitle: 'Nos clients en France', noun: 'client', match: (d) => d.isClient },
  { key: 'pv', label: 'PV', subtitle: 'Magasins en Prospection de Valeur', noun: 'magasin', match: (d) => d.isPV },
];

/** Rayon du cercle de prospection dessiné autour d'une zone recherchée. */
const ZONE_LABEL = '100 km';

function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/** « 48.85, 2.35 » → coordonnées ; null si la saisie n'est pas un couple lat/lng. */
function parseLatLng(value: string): [number, number] | null {
  const m = value.match(/^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(',', '.'));
  const lng = parseFloat(m[2].replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

/**
 * Géocodage côté navigateur via la Base Adresse Nationale (gratuite, sans clé).
 * Utilisé pour la recherche de zone et la localisation manuelle ; le géocodage
 * en masse des magasins reste, lui, fait côté serveur (et mis en cache en base).
 */
async function banSearch(query: string, municipalityOnly = false): Promise<{ lat: number; lng: number; label: string } | null> {
  const q = query.trim();
  if (!q) return null;
  const url =
    'https://api-adresse.data.gouv.fr/search/?limit=1' +
    (municipalityOnly ? '&type=municipality' : '') +
    '&q=' + encodeURIComponent(q);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const feature = data?.features?.[0];
    const coords = feature?.geometry?.coordinates;
    if (!coords || coords.length < 2) return null;
    return { lat: coords[1], lng: coords[0], label: feature.properties?.city || feature.properties?.label || q };
  } catch {
    return null;
  }
}

interface FilterEntry {
  key: string;
  label: string;
  color: string;
  count: number;
  order: number;
  // Pipeline affiché en complément quand deux étapes portent le même nom
  // (« Démo prévue » existe dans Prospection ET dans Closing).
  hint?: string;
}

export default function MapView() {
  const [deals, setDeals] = useState<MapDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string>('');
  const [reloadKey, setReloadKey] = useState(0);

  const [tab, setTab] = useState<TabKey>('tous');
  const [query, setQuery] = useState('');
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const [selectedStages, setSelectedStages] = useState<Set<string>>(new Set());

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: number } | null>(null);
  const [openedDealId, setOpenedDealId] = useState<string | null>(null);

  const [zoneQuery, setZoneQuery] = useState('');
  const [zone, setZone] = useState<Zone | null>(null);

  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [locateId, setLocateId] = useState<string | null>(null);
  const [locateValue, setLocateValue] = useState('');
  const [locateMsg, setLocateMsg] = useState<{ text: string; kind: 'info' | 'err' | 'ok' }>({ text: '', kind: 'info' });
  const [locateBusy, setLocateBusy] = useState(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2800);
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // ── Chargement des données CRM ──────────────────────────────────────────
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
        } else {
          setDeals(data.deals || []);
        }
      } catch {
        if (!cancelled) {
          setError('Impossible de charger la carte');
          setDeals([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadedAt(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const tabMeta = TABS.find((t) => t.key === tab) || TABS[0];

  // Périmètre de l'onglet courant : base des filtres, des compteurs et de la liste.
  const scoped = useMemo(() => deals.filter(tabMeta.match), [deals, tabMeta]);

  // Enseignes présentes (filtre), triées par nombre de magasins.
  const brands = useMemo<FilterEntry[]>(() => {
    const map = new Map<string, FilterEntry>();
    for (const d of scoped) {
      const label = d.brandName || 'Sans enseigne';
      const entry = map.get(label) || { key: label, label, color: displayColor(d.brandColor), count: 0, order: 0 };
      entry.count += 1;
      map.set(label, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [scoped]);

  // Étapes présentes, ordonnées par position globale (pipeline puis colonne).
  // Clé composite pipeline+titre : une même étape (ex. « Démo prévue ») peut
  // exister dans les deux pipelines sans être fusionnée.
  const stages = useMemo<FilterEntry[]>(() => {
    const map = new Map<string, FilterEntry>();
    const pipelinesByTitle = new Map<string, Set<string>>();
    for (const d of scoped) {
      const key = `${d.pipelineName}::${d.columnTitle}`;
      const entry = map.get(key) || {
        key,
        label: d.columnTitle,
        color: stageColor(d.columnColor),
        count: 0,
        order: d.columnPosition,
      };
      entry.count += 1;
      map.set(key, entry);
      const seen = pipelinesByTitle.get(d.columnTitle) || new Set<string>();
      seen.add(d.pipelineName);
      pipelinesByTitle.set(d.columnTitle, seen);
    }
    const list = Array.from(map.values());
    for (const entry of list) {
      if ((pipelinesByTitle.get(entry.label)?.size ?? 0) > 1) entry.hint = entry.key.split('::')[0];
    }
    return list.sort((a, b) => a.order - b.order);
  }, [scoped]);

  // Filtrage : recherche libre (enseigne, magasin, ville, code postal) +
  // sélections d'enseignes et d'étapes.
  const visible = useMemo(() => {
    const q = norm(query);
    return scoped.filter((d) => {
      if (selectedBrands.size && !selectedBrands.has(d.brandName || 'Sans enseigne')) return false;
      if (selectedStages.size && !selectedStages.has(`${d.pipelineName}::${d.columnTitle}`)) return false;
      if (!q) return true;
      return (
        norm(d.brandName || '').includes(q) ||
        norm(d.storeName).includes(q) ||
        norm(d.city).includes(q) ||
        d.postalCode.startsWith(q)
      );
    });
  }, [scoped, query, selectedBrands, selectedStages]);

  const located = useMemo(() => visible.filter(isLocated) as LocatedDeal[], [visible]);
  const missingCount = visible.length - located.length;

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const focusDeal = (deal: MapDeal) => {
    setSelectedId(deal.id);
    if (isLocated(deal)) setFocus({ lat: deal.latitude, lng: deal.longitude, key: Date.now() });
    else showToast(`« ${deal.storeName} » n'est pas localisé — clique sur « Localiser »`);
  };

  // ── Recherche de zone (cercle de 100 km) ────────────────────────────────
  const gotoZone = async () => {
    const value = zoneQuery.trim();
    if (!value) return;
    const manual = parseLatLng(value);
    if (manual) {
      setZone({ lat: manual[0], lng: manual[1], label: value, key: Date.now() });
      return;
    }
    // Sans chiffre dans la saisie, on privilégie la commune : « Lorient »
    // renvoie la ville, pas la première rue qui porte ce nom.
    const found = await banSearch(value, !/\d/.test(value));
    if (!found) {
      showToast('Zone introuvable — essaie une autre formulation');
      return;
    }
    setZone({ lat: found.lat, lng: found.lng, label: found.label, key: Date.now() });
  };

  // ── Localisation manuelle d'un magasin ──────────────────────────────────
  const locateDeal = deals.find((d) => d.id === locateId) || null;

  const openLocate = (deal: MapDeal) => {
    setLocateId(deal.id);
    setLocateValue([deal.address, deal.postalCode, deal.city].filter(Boolean).join(' ').trim());
    setLocateMsg({ text: '', kind: 'info' });
  };

  const closeLocate = () => {
    setLocateId(null);
    setLocateBusy(false);
  };

  const applyLocate = async () => {
    if (!locateDeal) return;
    const value = locateValue.trim();
    if (!value) {
      setLocateMsg({ text: 'Entre une ville, une adresse ou des coordonnées.', kind: 'err' });
      return;
    }
    setLocateBusy(true);
    let coords = parseLatLng(value);
    if (!coords) {
      setLocateMsg({ text: 'Recherche…', kind: 'info' });
      const found = await banSearch(value);
      if (found) coords = [found.lat, found.lng];
    }
    if (!coords) {
      setLocateBusy(false);
      setLocateMsg({ text: 'Introuvable. Essaie autrement, ou saisis des coordonnées « lat, lng ».', kind: 'err' });
      return;
    }
    try {
      const res = await fetch(`/api/deals/${locateDeal.id}/geocode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: coords[0], longitude: coords[1] }),
      });
      const data = await res.json().catch(() => ({}));
      // `skipped` = mode données fictives : rien à persister, on met quand
      // même la carte à jour pour que la démo reste cohérente.
      if (!res.ok || (data.located !== true && !data.skipped)) throw new Error('save');
    } catch {
      setLocateBusy(false);
      setLocateMsg({ text: 'Enregistrement impossible. Réessaie dans un instant.', kind: 'err' });
      return;
    }
    const [lat, lng] = coords;
    const id = locateDeal.id;
    const name = locateDeal.storeName;
    setDeals((prev) => prev.map((d) => (d.id === id ? { ...d, latitude: lat, longitude: lng } : d)));
    setLocateBusy(false);
    closeLocate();
    setSelectedId(id);
    setFocus({ lat, lng, key: Date.now() });
    showToast(`« ${name} » localisé`);
  };

  const ledClass = loading ? ' is-loading' : error ? ' is-err' : '';
  const sourceText = loading
    ? 'Chargement des données CRM…'
    : error
      ? 'CRM injoignable'
      : `Données CRM · maj ${loadedAt}${missingCount ? ` · ${missingCount} non localisé${missingCount > 1 ? 's' : ''}` : ''}`;

  return (
    <div className="slm">
      {/* ── Colonne de gauche ─────────────────────────────────────────── */}
      <aside className="slm-side">
        <div className="slm-brand">
          <div className="slm-mark">
            <span className="slm-dot" />
            <h1>Swipelink</h1>
          </div>
          <p>{tabMeta.subtitle}</p>
        </div>

        <div className="slm-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={'slm-tab' + (t.key === tab ? ' is-active' : '')}
              onClick={() => {
                if (t.key === tab) return;
                setTab(t.key);
                setQuery('');
                setSelectedBrands(new Set());
                setSelectedStages(new Set());
                setSelectedId(null);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="slm-controls">
          <div className="slm-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une enseigne, un magasin, une ville…"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="slm-meta">
          <span className="slm-count">
            <b>{visible.length}</b> {tabMeta.noun}{visible.length > 1 ? 's' : ''}
          </span>
          <button
            className={'slm-refresh' + (loading ? ' is-busy' : '')}
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={loading}
            title="Recharger depuis le CRM"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 3v6h-6" />
            </svg>
            Actualiser
          </button>
        </div>

        {/* Filtre par enseigne */}
        {brands.length > 1 && (
          <div className="slm-filters">
            <div className="slm-filters-head">
              <span>Enseignes</span>
              {selectedBrands.size > 0 && <button onClick={() => setSelectedBrands(new Set())}>Tout afficher</button>}
            </div>
            <div className="slm-chips">
              {brands.map((b) => {
                const active = selectedBrands.has(b.key);
                return (
                  <button
                    key={b.key}
                    className={'slm-chip' + (active ? ' is-active' : '')}
                    style={active ? { borderColor: b.color, background: b.color + '22' } : undefined}
                    onClick={() => toggle(setSelectedBrands, b.key)}
                    title={`${b.count} magasin(s)`}
                  >
                    <span className="slm-swatch" style={{ background: b.color }} />
                    {b.label}
                    <span className="slm-n">{b.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Filtre par étape de pipeline */}
        {stages.length > 1 && (
          <div className="slm-filters">
            <div className="slm-filters-head">
              <span>Étapes</span>
              {selectedStages.size > 0 && <button onClick={() => setSelectedStages(new Set())}>Tout afficher</button>}
            </div>
            <div className="slm-chips">
              {stages.map((s) => {
                const active = selectedStages.has(s.key);
                return (
                  <button
                    key={s.key}
                    className={'slm-chip' + (active ? ' is-active' : '')}
                    style={active ? { borderColor: s.color, background: s.color + '22' } : undefined}
                    onClick={() => toggle(setSelectedStages, s.key)}
                    title={`${s.key.split('::')[0]} · ${s.count} magasin(s)`}
                  >
                    <span className="slm-swatch sq" style={{ background: s.color }} />
                    {s.label}
                    {s.hint && <span className="slm-hint">{s.hint}</span>}
                    <span className="slm-n">{s.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Liste */}
        <div className="slm-list">
          {error ? (
            <div className="slm-error">{error}</div>
          ) : loading && visible.length === 0 ? (
            <div className="slm-empty">Chargement…</div>
          ) : visible.length === 0 ? (
            <div className="slm-empty">Aucun magasin ne correspond.</div>
          ) : (
            visible.map((d) => {
              const miss = !isLocated(d);
              const color = displayColor(d.brandColor);
              return (
                <div
                  key={d.id}
                  className={'slm-row' + (d.id === selectedId ? ' is-active' : '')}
                  onClick={() => focusDeal(d)}
                  onDoubleClick={() => setOpenedDealId(d.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') focusDeal(d); }}
                >
                  <span
                    className={'slm-pin' + (miss ? ' is-miss' : '')}
                    style={miss ? undefined : { background: color, border: `1.5px solid ${stageColor(d.columnColor)}` }}
                  />
                  <div className="slm-info">
                    <div className="slm-name">{d.storeName}</div>
                    <div className={'slm-city' + (miss ? ' is-miss' : '')}>
                      {[d.postalCode, d.city].filter(Boolean).join(' ') || '—'}
                      {miss ? ' · non localisé' : ''}
                    </div>
                    <div className="slm-stage">
                      <i style={{ background: stageColor(d.columnColor) }} />
                      {d.columnTitle}
                      {d.isClient && <span className="slm-tag" style={{ color: '#2f9e6f' }}>CLIENT</span>}
                      {d.isPV && !d.isClient && <span className="slm-tag" style={{ color: '#c63f24' }}>PV</span>}
                    </div>
                  </div>
                  <button
                    className={'slm-loc' + (miss ? ' is-need' : '')}
                    title={miss ? 'Définir la localisation' : 'Corriger la localisation'}
                    onClick={(e) => { e.stopPropagation(); openLocate(d); }}
                  >
                    {miss ? (
                      'Localiser'
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11Z" />
                        <circle cx="12" cy="10" r="2.5" />
                      </svg>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="slm-legend-note">
          <span>Pastille = enseigne · anneau = étape · double-clic = fiche</span>
        </div>

        <div className="slm-source">
          <span className={'slm-led' + ledClass} />
          <span>{sourceText}</span>
        </div>
      </aside>

      {/* ── Carte ─────────────────────────────────────────────────────── */}
      <div className="slm-mapwrap">
        <DealsMap
          deals={located}
          focus={focus}
          zone={zone}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onOpenDeal={setOpenedDealId}
        />

        <div className="slm-zonebox">
          <input
            value={zoneQuery}
            onChange={(e) => setZoneQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') gotoZone(); }}
            placeholder="Aller à une zone (ville, adresse)…"
            title={`Dessine un cercle de ${ZONE_LABEL} autour du lieu`}
            autoComplete="off"
          />
          <button onClick={gotoZone} title="Localiser la zone">→</button>
          <button className="slm-clr" onClick={() => { setZoneQuery(''); setZone(null); }} title="Effacer la zone">✕</button>
        </div>

        <div className={'slm-toast' + (toast ? ' is-show' : '')}>{toast}</div>

        {locateDeal && (
          <div className="slm-locate" onClick={(e) => { if (e.target === e.currentTarget) closeLocate(); }}>
            <div className="slm-locate-card">
              <div className="slm-locate-title">
                Localiser <b>« {locateDeal.storeName} »</b>
              </div>
              <input
                value={locateValue}
                autoFocus
                onChange={(e) => setLocateValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyLocate();
                  if (e.key === 'Escape') closeLocate();
                }}
                placeholder="Ville, adresse, ou coordonnées « lat, lng »"
                autoComplete="off"
              />
              <div className={'slm-locate-msg' + (locateMsg.kind === 'err' ? ' is-err' : locateMsg.kind === 'ok' ? ' is-ok' : '')}>
                {locateMsg.text}
              </div>
              <div className="slm-locate-actions">
                <button className="slm-btn-ghost" onClick={closeLocate}>Annuler</button>
                <button className="slm-btn-accent" onClick={applyLocate} disabled={locateBusy}>
                  {locateBusy ? '…' : 'Valider'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Fiche détaillée de l'affaire (ouverte depuis la bulle ou au double-clic).
          Wrapper à z-index élevé : les couches Leaflet montent jusqu'à ~1000,
          le drawer (z-index 40 en interne) doit passer au-dessus. */}
      {openedDealId && (
        <div style={{ position: 'relative', zIndex: 2000 }}>
          <DealDrawer
            dealId={openedDealId}
            onClose={() => setOpenedDealId(null)}
            onUpdated={() => setReloadKey((k) => k + 1)}
            onNavigate={setOpenedDealId}
          />
        </div>
      )}
    </div>
  );
}
