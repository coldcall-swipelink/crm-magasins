'use client';
import { useState, useRef, useCallback } from 'react';
import AppLayout from '@/components/layout/AppLayout';

const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: 13, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '8px 16px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnDef: React.CSSProperties = { padding: '8px 16px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 13 };

const SAMPLE = `enseigne;nom magasin;ville;département;adresse;poste;titre;date publication;lien;salaire;contrat;source
Intermarché;Intermarché Nantes Sud;Nantes;44;12 rue de la Paix;Boucher;Boucher H/F CDI;2025-01-10;https://example.com/1;2200€/mois;CDI;Indeed
Leclerc;E.Leclerc Rennes;Rennes;35;45 av de Bretagne;Manager Rayon;Resp. rayon frais;2025-01-11;https://example.com/2;2800€/mois;CDI;Indeed
Super U;Super U Bordeaux;Bordeaux;33;8 bd des Capucins;Caissier;Caissier H/F;2025-01-12;;1600€;CDD;Pôle Emploi
Carrefour;Carrefour Market Lyon;Lyon;69;22 rue Garibaldi;Employé;Employé polyvalent;2025-01-13;https://example.com/4;1700€;CDI;Hellowork`;

interface Preview { fileName: string; text: string; rows: Record<string, string>[]; total: number; }
interface ImportResult { fileName: string; createdDeals: number; updatedDeals: number; newOffers: number; movedToCall: number; disappearedOffers: number; errorCount: number; errors: { row: number; message: string }[]; }

export default function ImportPage() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsePreview = useCallback((text: string, fileName: string) => {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { alert('Fichier CSV invalide.'); return; }
    const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
    const hdrs = lines[0].split(sep).map(h => h.trim());
    const rows = lines.slice(1, 6).map(l => { const v = l.split(sep); const r: Record<string,string> = {}; hdrs.forEach((h, i) => r[h] = (v[i] || '').trim()); return r; });
    setPreview({ fileName, text, rows, total: lines.length - 1 }); setResult(null);
  }, []);

  const handleFile = (f: File) => {
    if (!f?.name.toLowerCase().endsWith('.csv')) { alert('.csv requis'); return; }
    const r = new FileReader();
    r.onload = e => parsePreview(e.target!.result as string, f.name);
    r.readAsText(f, 'utf-8');
  };

  const runImport = async () => {
    if (!preview) return; setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', new Blob([preview.text], { type: 'text/csv' }), preview.fileName);
      const res = await fetch('/api/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data); setPreview(null);
    } catch (e) { alert((e as Error).message); } finally { setLoading(false); }
  };

  return (
    <AppLayout>
      <div style={{ padding: '24px', maxWidth: 780 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Importer un CSV</div>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>Déduplication automatique par magasin et offre.</p>

        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: '#78350f' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Règles appliquées</div>
          <div>✦ Nouveau magasin → <strong>« À appeler »</strong></div>
          <div>⟳ Magasin existant + nouvelle offre → <strong>retour en « À appeler »</strong></div>
          <div>= Offre déjà connue → colonne inchangée, date mise à jour</div>
          <div>✗ Offre disparue → marquée inactive, affaire inchangée</div>
        </div>

        {!preview && !result && (
          <>
            <div style={{ border: `2px dashed ${dragging ? '#6366f1' : '#cbd5e1'}`, borderRadius: 12, padding: '36px 24px', textAlign: 'center', background: dragging ? '#eef2ff' : '#f8fafc', cursor: 'pointer', marginBottom: 16, transition: 'all .15s' }}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📥</div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Glisser un fichier CSV ici</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>ou cliquer · séparateur , ou ;</div>
              <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Format CSV attendu</div>
              <pre style={{ fontSize: 10, color: '#475569', overflow: 'auto', background: '#f8fafc', borderRadius: 7, padding: 10, fontFamily: 'monospace', whiteSpace: 'pre' }}>{SAMPLE}</pre>
              <button style={{ ...btnDef, marginTop: 10, fontSize: 12 }} onClick={() => parsePreview(SAMPLE, 'exemple.csv')}>⟳ Charger l'exemple</button>
            </div>
          </>
        )}

        {preview && (
          <div>
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ padding: '10px 16px', borderBottom: '1px solid #e2e8f0', fontWeight: 600, fontSize: 13 }}>📄 {preview.fileName} — {preview.total} lignes</div>
              <div style={{ overflow: 'auto' }}>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead><tr>{Object.keys(preview.rows[0] || {}).map(h => <th key={h} style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#64748b', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
                  <tbody>{preview.rows.map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j} style={{ padding: '5px 10px', borderBottom: '1px solid #f1f5f9', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</td>)}</tr>)}</tbody>
                </table>
              </div>
              {preview.total > 5 && <div style={{ padding: '6px 16px', fontSize: 11, color: '#94a3b8' }}>… et {preview.total - 5} autres lignes</div>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btnPri} onClick={runImport} disabled={loading}>{loading ? '⟳ Import…' : `✓ Lancer l'import (${preview.total} lignes)`}</button>
              <button style={btnDef} onClick={() => setPreview(null)}>Annuler</button>
            </div>
          </div>
        )}

        {result && (
          <div style={{ background: '#14532d', border: '1px solid #16a34a', borderRadius: 12, padding: 20, color: '#86efac' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>✓ Import terminé — {result.fileName}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 14 }}>
              {[['Créées', result.createdDeals, '#86efac'], ['Màj', result.updatedDeals, '#fde047'], ['Nouvelles offres', result.newOffers, '#6ee7b7'], ['Rappelées', result.movedToCall, '#c4b5fd'], ['Disparues', result.disappearedOffers, '#fca5a5'], ['Erreurs', result.errorCount, result.errorCount ? '#fca5a5' : '#86efac']].map(([l, v, c]) => (
                <div key={l as string}><div style={{ fontSize: 10, color: '#86efac88', marginBottom: 2 }}>{l}</div><div style={{ fontSize: 22, fontWeight: 700, color: c as string }}>{v}</div></div>
              ))}
            </div>
            {(result.movedToCall || 0) > 0 && <div style={{ background: 'rgba(0,0,0,.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#a7f3d0', marginBottom: 12 }}><strong>{result.movedToCall} affaire{result.movedToCall > 1 ? 's' : ''}</strong> avec nouvelles offres replacées en « À appeler ».</div>}
            {result.errorCount > 0 && <div style={{ background: 'rgba(220,38,38,.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#fca5a5', marginBottom: 12 }}>⚠ {result.errorCount} erreur(s)</div>}
            <button style={{ ...btnDef, color: '#86efac', borderColor: '#16a34a', background: 'transparent', fontSize: 12 }} onClick={() => setResult(null)}>Faire un autre import</button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
