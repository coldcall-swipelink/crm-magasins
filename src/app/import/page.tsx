'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import AppLayout from '@/components/layout/AppLayout';

const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: 13, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '8px 16px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnDef: React.CSSProperties = { padding: '8px 16px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 13 };

type Mode = 'normal' | 'targeted' | 'notes';

const SAMPLE = `enseigne;nom magasin;ville;département;adresse;poste;titre;date publication;lien;salaire;contrat;source;note;auteur note;date note
Intermarché;Intermarché Nantes Sud;Nantes;44;12 rue de la Paix;Boucher;Boucher H/F CDI;2025-01-10;https://example.com/1;2200€/mois;CDI;Indeed;Déjà contacté en 2024, rappeler le directeur;Marie;2024-11-03 10:20:00
Leclerc;E.Leclerc Rennes;Rennes;35;45 av de Bretagne;Manager Rayon;Resp. rayon frais;2025-01-11;https://example.com/2;2800€/mois;CDI;Indeed;Intéressé par une démo;Marie;2024-12-12 15:11:41
Super U;Super U Bordeaux;Bordeaux;33;8 bd des Capucins;Caissier;Caissier H/F;2025-01-12;;1600€;CDD;Pôle Emploi;;;
Carrefour;Carrefour Market Lyon;Lyon;69;22 rue Garibaldi;Employé;Employé polyvalent;2025-01-13;https://example.com/4;1700€;CDI;Hellowork;Ne pas appeler avant septembre;Paul;2025-02-01 08:00:00`;

const SAMPLE_TARGETED = `enseigne;nom magasin;ville;département;adresse;note;auteur note;date note
Intermarché;Intermarché Nantes Sud;Nantes;44;12 rue de la Paix;Premier appel, pas de réponse;Marie;2024-11-03 10:20:00
Intermarché;Intermarché Nantes Sud;Nantes;44;12 rue de la Paix;Rappelé, RDV pris;Marie;2024-12-12 15:11:41
Intermarché;Intermarché Nantes Sud;Nantes;44;12 rue de la Paix;Démo réalisée, très intéressé;Paul;2025-01-20 09:00:00
Leclerc;E.Leclerc Rennes;Rennes;35;45 av de Bretagne;Devis envoyé en janvier;Paul;2025-01-08 09:30:00
Super U;Super U Bordeaux;Bordeaux;33;8 bd des Capucins;;;`;

const SAMPLE_NOTES = `enseigne;nom magasin;note;auteur note;date note
Intermarché;Intermarché Nantes Sud;Premier appel, pas de réponse;Marie;2024-11-03 10:20:00
Intermarché;Intermarché Nantes Sud;Rappelé, RDV pris;Marie;2024-12-12 15:11:41
Leclerc;E.Leclerc Rennes;Devis envoyé en janvier;Paul;2025-01-08 09:30:00`;

interface Preview { fileName: string; text: string; rows: Record<string, string>[]; total: number; }
interface ImportResult {
  fileName: string;
  createdDeals: number;
  updatedDeals?: number;
  updatedBrands?: number;
  newOffers?: number;
  movedToCall?: number;
  skippedExisting?: number;
  createdNotes?: number;
  columnTitle?: string;
  notesMode?: boolean;
  matchedDeals?: number;
  notFound?: number;
  errorCount: number;
  errors: { row: number; message: string }[];
}
interface Column { id: string; title: string; }
interface Pipeline { id: string; name: string; columns: Column[]; }

export default function ImportPage() {
  const [mode, setMode] = useState<Mode>('normal');
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
  const [targetColumnId, setTargetColumnId] = useState<string>('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Tous les pipelines et leurs étapes (mode ciblé) : choix pipeline puis étape.
  useEffect(() => {
    fetch('/api/pipelines')
      .then(r => r.json())
      .then(data => {
        const pls: Pipeline[] = (data.pipelines || []).map((p: { id: string; name: string; columns?: { id: string; title: string }[] }) => ({
          id: p.id,
          name: p.name,
          columns: (p.columns || []).map(c => ({ id: c.id, title: c.title })),
        }));
        setPipelines(pls);
        // Pipeline par défaut : « Prospection » s'il existe, sinon le premier.
        const def = pls.find(p => p.name === 'Prospection') || pls[0];
        if (def) {
          setSelectedPipelineId(def.id);
          if (def.columns.length) setTargetColumnId(def.columns[0].id);
        }
      })
      .catch(() => {});
  }, []);

  // Quand on change de pipeline, sélectionner sa première étape.
  const onSelectPipeline = (pipelineId: string) => {
    setSelectedPipelineId(pipelineId);
    const cols = pipelines.find(p => p.id === pipelineId)?.columns || [];
    setTargetColumnId(cols[0]?.id || '');
  };

  const parsePreview = useCallback((text: string, fileName: string) => {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
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
    if (!preview) return;
    if (mode === 'targeted' && !targetColumnId) { alert('Choisissez une colonne de destination.'); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', new Blob([preview.text], { type: 'text/csv' }), preview.fileName);
      if (mode === 'targeted') fd.append('columnId', targetColumnId);
      if (mode === 'notes') fd.append('mode', 'notes');
      const res = await fetch('/api/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data); setPreview(null);
    } catch (e) { alert((e as Error).message); } finally { setLoading(false); }
  };

  const isTargeted = mode === 'targeted';
  const isNotes = mode === 'notes';
  const sample = isNotes ? SAMPLE_NOTES : isTargeted ? SAMPLE_TARGETED : SAMPLE;
  const columns = pipelines.find(p => p.id === selectedPipelineId)?.columns || [];
  const targetColumnTitle = columns.find(c => c.id === targetColumnId)?.title || '';
  const selectedPipelineName = pipelines.find(p => p.id === selectedPipelineId)?.name || '';

  const modeBtn = (m: Mode): React.CSSProperties => ({
    flex: 1, padding: '10px 14px', borderRadius: 9, cursor: 'pointer', textAlign: 'left',
    border: `1px solid ${mode === m ? '#6366f1' : '#e2e8f0'}`,
    background: mode === m ? '#eef2ff' : '#fff',
  });

  return (
    <AppLayout>
      <div style={{ padding: '24px', maxWidth: 780 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Importer un CSV</div>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>Déduplication automatique par magasin.</p>

        {/* Choix du mode */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <button style={modeBtn('normal')} onClick={() => { setMode('normal'); setResult(null); }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: mode === 'normal' ? '#4338ca' : '#0f172a' }}>📥 Import normal</div>
            <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>Avec offres · règles métier (À appeler, retours…)</div>
          </button>
          <button style={modeBtn('targeted')} onClick={() => { setMode('targeted'); setResult(null); }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: mode === 'targeted' ? '#4338ca' : '#0f172a' }}>🎯 Import ciblé (sans offres)</div>
            <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>Place les nouveaux magasins dans une colonne choisie</div>
          </button>
          <button style={modeBtn('notes')} onClick={() => { setMode('notes'); setResult(null); }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: mode === 'notes' ? '#4338ca' : '#0f172a' }}>🗒️ Import de notes</div>
            <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>Rattache des notes aux affaires existantes</div>
          </button>
        </div>

        {/* Sélecteurs pipeline + étape (mode ciblé) */}
        {isTargeted && (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 6 }}>Pipeline</label>
              <select value={selectedPipelineId} onChange={e => onSelectPipeline(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                {pipelines.length === 0 && <option value="">Chargement…</option>}
                {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 6 }}>Étape de destination</label>
              <select value={targetColumnId} onChange={e => setTargetColumnId(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                {columns.length === 0 && <option value="">—</option>}
                {columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Règles selon le mode */}
        {isNotes ? (
          <div style={{ background: '#fdf2f8', border: '1px solid #fbcfe8', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: '#9d174d' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Import de notes</div>
            <div>🗒️ Rattache chaque note à une <strong>affaire existante</strong> (aucun deal créé)</div>
            <div>🔗 Correspondance par <strong>enseigne + nom magasin</strong> (ou SIRET / id magasin si présents)</div>
            <div>📚 <strong>Une ligne par note</strong> — notes dédupliquées (réimport sans doublon)</div>
            <div>🕓 Colonne <strong>date note</strong> facultative (ex. <code>2024-12-12 15:11:41</code>)</div>
            <div>⏭ Magasin introuvable → ligne <strong>ignorée</strong> (signalée dans le résumé)</div>
          </div>
        ) : isTargeted ? (
          <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: '#3730a3' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Import ciblé</div>
            <div>🎯 Nouveaux magasins → <strong>{selectedPipelineName || '…'}</strong> · étape <strong>« {targetColumnTitle || '…'} »</strong></div>
            <div>⏭ Magasin déjà présent → <strong>ignoré</strong> (deals existants non modifiés)</div>
            <div>🗂 CSV sans colonnes d'offres (poste, titre, date, lien…)</div>
            <div>📝 Colonne <strong>note</strong> facultative → reprise des notes de l'ancien CRM</div>
            <div>🕓 Colonne <strong>date note</strong> facultative (ex. <code>2024-12-12 15:11:41</code>) → date d'origine conservée</div>
            <div>📚 Plusieurs notes ? <strong>une ligne par note</strong> (mêmes infos magasin répétées) — notes dédupliquées</div>
          </div>
        ) : (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: '#78350f' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Règles appliquées</div>
            <div>✦ Nouveau magasin → <strong>« À appeler »</strong></div>
            <div>⟳ Magasin existant + nouvelle offre → <strong>retour en « À appeler »</strong></div>
            <div>= Offre déjà connue → colonne inchangée, date mise à jour</div>
            <div>📝 Colonne <strong>note</strong> facultative → rattachée à l'affaire</div>
            <div>🕓 Colonne <strong>date note</strong> facultative (ex. <code>2024-12-12 15:11:41</code>) → date d'origine conservée</div>
            <div>📚 Plusieurs notes ? <strong>une ligne par note</strong> (mêmes infos magasin répétées) — notes dédupliquées</div>
          </div>
        )}

        {!preview && !result && (
          <>
            <div style={{ border: `2px dashed ${dragging ? '#6366f1' : '#cbd5e1'}`, borderRadius: 12, padding: '36px 24px', textAlign: 'center', background: dragging ? '#eef2ff' : '#f8fafc', cursor: 'pointer', marginBottom: 16, transition: 'all .15s' }}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>{isNotes ? '🗒️' : isTargeted ? '🎯' : '📥'}</div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Glisser un fichier CSV ici</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>ou cliquer · séparateur , ou ;</div>
              <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Format CSV attendu{isNotes ? ' (notes)' : isTargeted ? ' (sans offres)' : ''}</div>
              <pre style={{ fontSize: 10, color: '#475569', overflow: 'auto', background: '#f8fafc', borderRadius: 7, padding: 10, fontFamily: 'monospace', whiteSpace: 'pre' }}>{sample}</pre>
              <button style={{ ...btnDef, marginTop: 10, fontSize: 12 }} onClick={() => parsePreview(sample, isNotes ? 'exemple-notes.csv' : isTargeted ? 'exemple-cible.csv' : 'exemple.csv')}>⟳ Charger l'exemple</button>
            </div>
          </>
        )}

        {preview && (
          <div>
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ padding: '10px 16px', borderBottom: '1px solid #e2e8f0', fontWeight: 600, fontSize: 13 }}>📄 {preview.fileName} — {preview.total} lignes{isTargeted && targetColumnTitle ? ` → « ${targetColumnTitle} »` : ''}</div>
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
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>✓ Import terminé — {result.fileName}{result.columnTitle ? ` → « ${result.columnTitle} »` : ''}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 14 }}>
              {(result.notesMode
                ? [['Notes créées', result.createdNotes ?? 0, '#f9a8d4'], ['Affaires concernées', result.matchedDeals ?? 0, '#86efac'], ['Magasins introuvables', result.notFound ?? 0, '#fde047'], ['Erreurs', result.errorCount, result.errorCount ? '#fca5a5' : '#86efac']]
                : result.columnTitle
                ? [['Créées', result.createdDeals, '#86efac'], ['Enseigne corrigée', result.updatedBrands ?? 0, '#67e8f9'], ['Ignorées (déjà présentes)', result.skippedExisting ?? 0, '#fde047'], ['Notes', result.createdNotes ?? 0, '#f9a8d4'], ['Erreurs', result.errorCount, result.errorCount ? '#fca5a5' : '#86efac']]
                : [['Créées', result.createdDeals, '#86efac'], ['Màj', result.updatedDeals ?? 0, '#fde047'], ['Nouvelles offres', result.newOffers ?? 0, '#6ee7b7'], ['Rappelées', result.movedToCall ?? 0, '#c4b5fd'], ['Notes', result.createdNotes ?? 0, '#f9a8d4'], ['Erreurs', result.errorCount, result.errorCount ? '#fca5a5' : '#86efac']]
              ).map(([l, v, c]) => (
                <div key={l as string}><div style={{ fontSize: 10, color: '#86efac88', marginBottom: 2 }}>{l}</div><div style={{ fontSize: 22, fontWeight: 700, color: c as string }}>{v}</div></div>
              ))}
            </div>
            {result.columnTitle && (result.updatedBrands || 0) > 0 && <div style={{ background: 'rgba(0,0,0,.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#a5f3fc', marginBottom: 12 }}><strong>{result.updatedBrands} enseigne{(result.updatedBrands || 0) > 1 ? 's' : ''}</strong> renseignée{(result.updatedBrands || 0) > 1 ? 's' : ''} sur des magasins existants (sans doublon).</div>}
            {result.columnTitle && (result.skippedExisting || 0) > 0 && <div style={{ background: 'rgba(0,0,0,.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#fde68a', marginBottom: 12 }}><strong>{result.skippedExisting} magasin{(result.skippedExisting || 0) > 1 ? 's' : ''}</strong> déjà présent{(result.skippedExisting || 0) > 1 ? 's' : ''} — ignoré{(result.skippedExisting || 0) > 1 ? 's' : ''}.</div>}
            {!result.columnTitle && !result.notesMode && (result.movedToCall || 0) > 0 && <div style={{ background: 'rgba(0,0,0,.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#a7f3d0', marginBottom: 12 }}><strong>{result.movedToCall} affaire{(result.movedToCall || 0) > 1 ? 's' : ''}</strong> avec nouvelles offres replacées en « À appeler ».</div>}
            {result.notesMode && (result.notFound || 0) > 0 && <div style={{ background: 'rgba(0,0,0,.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#fde68a', marginBottom: 12 }}><strong>{result.notFound} ligne{(result.notFound || 0) > 1 ? 's' : ''}</strong> sans affaire correspondante — note{(result.notFound || 0) > 1 ? 's' : ''} ignorée{(result.notFound || 0) > 1 ? 's' : ''} (vérifie enseigne + nom magasin).</div>}
            {result.errorCount > 0 && <div style={{ background: 'rgba(220,38,38,.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#fca5a5', marginBottom: 12 }}>⚠ {result.errorCount} erreur(s)</div>}
            <button style={{ ...btnDef, color: '#86efac', borderColor: '#16a34a', background: 'transparent', fontSize: 12 }} onClick={() => setResult(null)}>Faire un autre import</button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
