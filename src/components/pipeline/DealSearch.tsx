'use client';
import { useState, useEffect, useRef } from 'react';

interface Result {
  id: string;
  store?: {
    name?: string;
    city?: string;
    department?: string;
    brand?: { name?: string; color?: string } | null;
  } | null;
  column?: { title?: string; color?: string } | null;
}

interface Props { onSelect: (dealId: string) => void; }

// Surligne la portion de texte qui correspond à la requête (insensible à la casse).
function highlight(text: string, q: string) {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: '#fef08a', color: 'inherit', padding: 0, borderRadius: 2 }}>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export default function DealSearch({ onSelect }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // Recherche débouncée (220 ms) à partir de 2 caractères.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setLoading(false); setOpen(false); return; }
    setLoading(true);
    setOpen(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/deals/search?q=${encodeURIComponent(term)}`);
        if (res.ok) { setResults(await res.json()); setActive(0); }
      } catch { /* ignore */ } finally { setLoading(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  // Fermeture au clic à l'extérieur.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = (r?: Result) => {
    if (!r) return;
    onSelect(r.id);
    setOpen(false);
    setQ('');
    setResults([]);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown')      { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter')     { e.preventDefault(); choose(results[active]); }
    else if (e.key === 'Escape')    { setOpen(false); }
  };

  const term = q.trim();

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#94a3b8', pointerEvents: 'none' }}>🔍</span>
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        onKeyDown={onKey}
        onFocus={() => { if (results.length) setOpen(true); }}
        placeholder="Rechercher une affaire…"
        style={{ height: 38, padding: '0 12px 0 32px', borderRadius: 9, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 13, width: 240, outline: 'none' }}
      />

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
          width: 380, maxWidth: '90vw', background: '#fff', borderRadius: 11,
          border: '1px solid #e2e8f0', boxShadow: '0 12px 32px rgba(15,23,42,0.16)',
          overflow: 'hidden',
        }}>
          {loading && results.length === 0 && (
            <div style={{ padding: '14px 16px', fontSize: 13, color: '#94a3b8' }}>Recherche…</div>
          )}
          {!loading && results.length === 0 && term.length >= 2 && (
            <div style={{ padding: '14px 16px', fontSize: 13, color: '#94a3b8' }}>Aucune affaire trouvée pour « {term} »</div>
          )}
          {results.map((r, i) => {
            const brand = r.store?.brand;
            const dot = brand?.color || r.column?.color || '#94a3b8';
            const sub = [brand?.name, r.store?.city && `${r.store.city}${r.store?.department ? ` (${r.store.department})` : ''}`, r.column?.title]
              .filter(Boolean).join(' · ');
            return (
              <button
                key={r.id}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  padding: '9px 14px', border: 'none', cursor: 'pointer',
                  background: i === active ? '#f1f5f9' : '#fff',
                  borderTop: i === 0 ? 'none' : '1px solid #f1f5f9',
                }}
              >
                <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: dot, border: dot.toLowerCase() === '#ffffff' ? '1px solid #cbd5e1' : 'none' }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {highlight(r.store?.name || 'Affaire', term)}
                  </span>
                  {sub && <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
