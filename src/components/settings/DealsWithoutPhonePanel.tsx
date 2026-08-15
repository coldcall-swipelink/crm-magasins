'use client';
// src/components/settings/DealsWithoutPhonePanel.tsx
// Saisie manuelle des numéros manquants (Paramètres). La recherche automatique
// (panneau du dessus) laisse toujours un reliquat : magasins absents des
// sources, fiches sans téléphone, enseignes trop génériques pour trancher.
// Ce panneau liste les affaires concernées — celles qu'on ne peut donc PAS
// appeler — et enregistre le numéro tapé directement sur l'affaire.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/Toast';

const btnPri: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnXs: React.CSSProperties = { padding: '3px 9px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#334155', cursor: 'pointer', fontSize: 11.5, fontWeight: 500 };

interface Item {
  dealId: string;
  storeId: string;
  label: string;
  address: string;
  storePhone: string;
  columnTitle: string;
}

/** Nombre d'affaires chargées par page (« Afficher plus » charge la suivante). */
const PAGE_SIZE = 50;

export default function DealsWithoutPhonePanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  // Numéro en cours de saisie, par affaire, et affaires dont l'enregistrement
  // est en vol (évite un double envoi sur Entrée + clic). Suivi par affaire et
  // non globalement : saisir un numéro ne doit pas bloquer la ligne suivante.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<string[]>([]);
  // Identifie la dernière requête lancée : une recherche lente ne doit pas
  // écraser le résultat d'une recherche tapée après elle.
  const requestRef = useRef(0);

  const load = useCallback(async (q: string, offset: number) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, limit: String(PAGE_SIZE), offset: String(offset) });
      const res = await fetch(`/api/deals/without-phone?${params}`);
      if (!res.ok) { toast('Chargement impossible', 'error'); return; }
      const data = await res.json();
      if (requestId !== requestRef.current) return;
      setItems(prev => (offset === 0 ? data.items : [...prev, ...data.items]));
      setTotal(data.total ?? 0);
    } catch {
      if (requestId === requestRef.current) toast('Chargement impossible', 'error');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  // Recherche débouncée (et chargement initial, query vide).
  useEffect(() => {
    const t = setTimeout(() => { load(query.trim(), 0); }, 250);
    return () => clearTimeout(t);
  }, [query, load]);

  const save = async (item: Item, rawPhone: string) => {
    const phone = (rawPhone || '').trim();
    if (!phone || savingIds.includes(item.dealId)) return;
    setSavingIds(ids => [...ids, item.dealId]);
    try {
      const res = await fetch('/api/deals/without-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId: item.dealId, phone }),
      });
      const data = await res.json().catch(() => ({}));
      // Numéro refusé (trop court, étranger, suite fictive) : on garde la
      // saisie à l'écran pour la corriger plutôt que de la perdre.
      if (!res.ok) { toast(data.error || 'Enregistrement impossible', 'error'); return; }

      // L'affaire a désormais un numéro : elle sort de la liste.
      setItems(prev => prev.filter(i => i.dealId !== item.dealId));
      setTotal(t => Math.max(0, t - 1));
      setDrafts(d => { const next = { ...d }; delete next[item.dealId]; return next; });
      toast(`✓ ${data.phone} enregistré`);
    } catch {
      toast('Enregistrement impossible', 'error');
    } finally {
      setSavingIds(ids => ids.filter(id => id !== item.dealId));
    }
  };

  return (
    <div style={{ marginBottom: 28, border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, background: '#f8fafc' }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Affaires sans numéro de téléphone</div>
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
        Les affaires qu&apos;on ne peut pas appeler, faute de numéro. Saisissez-le ici : il est enregistré
        directement sur l&apos;affaire (et sur le magasin s&apos;il n&apos;en avait pas), et la ligne disparaît de la
        liste. Le format est libre — <code>03 20 12 34 56</code>, <code>+33320123456</code>,
        <code>03.20.12.34.56</code> donnent le même numéro.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filtrer par enseigne, magasin, ville ou code postal"
          style={{ flex: 1, minWidth: 240, padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a', fontSize: 13, outline: 'none' }}
        />
        <span style={{ fontSize: 12.5, color: '#475569', fontWeight: 600 }}>
          {loading && items.length === 0 ? 'Chargement…' : `${total} affaire${total > 1 ? 's' : ''} sans numéro`}
        </span>
        <button style={btnXs} onClick={() => load(query.trim(), 0)}>↻ Rafraîchir</button>
      </div>

      {items.length === 0 ? (
        <div style={{ fontSize: 12.5, color: '#94a3b8' }}>
          {loading ? 'Chargement…' : query.trim()
            ? 'Aucune affaire sans numéro ne correspond à cette recherche.'
            : 'Toutes les affaires ont un numéro de téléphone.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(item => {
            const draft = drafts[item.dealId] ?? '';
            const busy = savingIds.includes(item.dealId);
            return (
              <div key={item.dealId} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                    {item.label}
                    {item.columnTitle && (
                      <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 600, color: '#64748b', background: '#f1f5f9', borderRadius: 999, padding: '1px 7px' }}>
                        {item.columnTitle}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{item.address}</div>
                </div>

                {/* Le magasin a un numéro que l'affaire n'a pas : un clic suffit. */}
                {item.storePhone && (
                  <button
                    style={{ ...btnXs, color: '#4f46e5', borderColor: '#c7d2fe' }}
                    disabled={busy}
                    onClick={() => save(item, item.storePhone)}
                  >
                    Reprendre {item.storePhone}
                  </button>
                )}

                {/* Recherche à la main : la fiche de l'établissement porte
                    presque toujours le numéro de l'accueil. */}
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent(`${item.label} téléphone`)}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ ...btnXs, textDecoration: 'none', color: '#64748b' }}
                >
                  Chercher ↗
                </a>

                <input
                  value={draft}
                  disabled={busy}
                  placeholder="03 20 12 34 56"
                  onChange={e => setDrafts(d => ({ ...d, [item.dealId]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') save(item, draft); }}
                  style={{ width: 160, padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a', fontSize: 13, outline: 'none', fontVariantNumeric: 'tabular-nums' }}
                />
                <button
                  style={{ ...btnPri, opacity: busy || !draft.trim() ? 0.5 : 1, cursor: busy || !draft.trim() ? 'not-allowed' : 'pointer' }}
                  disabled={busy || !draft.trim()}
                  onClick={() => save(item, draft)}
                >
                  {busy ? '⟳' : 'Enregistrer'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {items.length > 0 && items.length < total && (
        <button
          style={{ ...btnXs, marginTop: 10 }}
          disabled={loading}
          onClick={() => load(query.trim(), items.length)}
        >
          {loading ? 'Chargement…' : `Afficher plus (${total - items.length} restantes)`}
        </button>
      )}
    </div>
  );
}
