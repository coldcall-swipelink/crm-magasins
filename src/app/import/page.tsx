'use client';
// src/app/import/page.tsx
import { useState, useRef, useCallback } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { Upload, CheckCircle2, AlertCircle, Info, FileText } from 'lucide-react';
import type { ImportResult } from '@/lib/import/importService';

const SAMPLE_CSV = `enseigne;nom magasin;ville;département;adresse;poste;titre;date publication;lien;salaire;contrat;source
Intermarché;Intermarché Nantes Sud;Nantes;44;12 rue de la Paix;Boucher;Boucher H/F CDI;2025-01-10;https://example.com/1;2200€/mois;CDI;Indeed
Leclerc;E.Leclerc Rennes;Rennes;35;45 av de Bretagne;Manager rayon;Responsable rayon frais;2025-01-11;https://example.com/2;2800€/mois;CDI;Indeed
Super U;Super U Bordeaux;Bordeaux;33;8 bd des Capucins;Caissier;Caissier H/F mi-temps;2025-01-12;https://example.com/3;1600€/mois;CDD;Pole Emploi
Intermarché;Intermarché Nantes Sud;Nantes;44;12 rue de la Paix;Responsable Boucherie;Resp. Boucherie H/F;2025-01-10;https://example.com/4;3000€/mois;CDI;Indeed
Carrefour;Carrefour Market Lyon 7;Lyon;69;22 rue Garibaldi;Employé libre service;Employé polyvalent H/F;2025-01-13;https://example.com/5;1700€/mois;CDI;Hellowork
Aldi;Aldi Marseille Centre;Marseille;13;5 rue Paradis;Employé commercial;Employé commercial H/F;2025-02-01;https://example.com/6;1800€/mois;CDI;Hellowork`;

interface Preview {
  fileName: string;
  text:     string;
  rows:     Record<string, string>[];
  total:    number;
}

export default function ImportPage() {
  const [preview, setPreview]   = useState<Preview | null>(null);
  const [result,  setResult]    = useState<ImportResult | null>(null);
  const [loading, setLoading]   = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsePreview = useCallback((text: string, fileName: string) => {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { alert('Fichier CSV invalide ou vide.'); return; }
    const sep  = (lines[0].match(/;/g)?.length || 0) >= (lines[0].match(/,/g)?.length || 0) ? ';' : ',';
    const hdrs = lines[0].split(sep).map(h => h.trim());
    const rows = lines.slice(1, 6).map(l => {
      const vals = l.split(sep);
      const row: Record<string, string> = {};
      hdrs.forEach((h, i) => row[h] = (vals[i] || '').trim());
      return row;
    });
    setPreview({ fileName, text, rows, total: lines.length - 1 });
    setResult(null);
  }, []);

  const handleFile = (f: File) => {
    if (!f.name.toLowerCase().endsWith('.csv')) { alert('Fichier .csv requis'); return; }
    const reader = new FileReader();
    reader.onload = e => parsePreview(e.target!.result as string, f.name);
    reader.readAsText(f, 'utf-8');
  };

  const runImport = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      const blob = new Blob([preview.text], { type: 'text/csv' });
      const fd   = new FormData();
      fd.append('file', blob, preview.fileName);
      const res  = await fetch('/api/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur serveur');
      setResult(data);
      setPreview(null);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadSample = () => parsePreview(SAMPLE_CSV, 'exemple-semaine1.csv');

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-6 py-6">
        <h1 className="text-xl font-bold text-slate-900 mb-1">Importer un CSV</h1>
        <p className="text-sm text-slate-500 mb-5">La déduplication magasin et offre est automatique.</p>

        {/* Règle métier */}
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 text-xs text-amber-800">
          <Info size={14} className="flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-semibold mb-1">Règles appliquées à chaque import</div>
            <div>✦ Nouveau magasin → nouvelle affaire dans <strong>« À appeler »</strong></div>
            <div>⟳ Magasin existant + nouvelle offre → <strong>retour automatique en « À appeler »</strong></div>
            <div>= Magasin existant + offre identique → colonne inchangée, <code>lastSeenAt</code> mis à jour</div>
            <div>✗ Offre disparue → marquée inactive, affaire et colonne inchangées</div>
          </div>
        </div>

        {/* Zone de dépôt */}
        {!preview && !result && (
          <>
            <div
              className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all mb-5
                ${dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
            >
              <Upload size={36} className="mx-auto mb-4 text-indigo-400" />
              <p className="text-base font-medium text-slate-700 mb-1">Glisser un fichier CSV ici</p>
              <p className="text-sm text-slate-400">ou cliquer pour parcourir · séparateur , ou ;</p>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>

            {/* Exemple */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                <FileText size={15} /> Format CSV attendu
              </div>
              <pre className="text-[10px] text-slate-500 overflow-auto bg-slate-50 rounded-lg p-3 whitespace-pre">{SAMPLE_CSV}</pre>
              <button className="btn-secondary mt-3 text-xs flex items-center gap-2" onClick={loadSample}>
                ⟳ Charger les données d'exemple
              </button>
            </div>
          </>
        )}

        {/* Aperçu */}
        {preview && (
          <div>
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3">
                <FileText size={15} className="text-slate-400" />
                <span className="text-sm font-medium text-slate-700">{preview.fileName}</span>
                <span className="text-xs text-slate-400">— {preview.total} lignes détectées</span>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      {Object.keys(preview.rows[0] || {}).map(h => (
                        <th key={h} className="px-3 py-2 text-left text-slate-500 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        {Object.values(row).map((v, j) => (
                          <td key={j} className="px-3 py-2 text-slate-700 whitespace-nowrap max-w-32 truncate">{v}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.total > 5 && (
                <div className="px-4 py-2 text-xs text-slate-400 border-t border-slate-100">
                  … et {preview.total - 5} autres lignes
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                className="btn-primary flex items-center gap-2 disabled:opacity-60"
                onClick={runImport}
                disabled={loading}
              >
                {loading ? '⟳ Import en cours…' : `✓ Lancer l'import (${preview.total} lignes)`}
              </button>
              <button className="btn-secondary" onClick={() => setPreview(null)}>Annuler</button>
            </div>
          </div>
        )}

        {/* Résultat */}
        {result && (
          <div className="bg-emerald-900 border border-emerald-700 rounded-2xl p-6">
            <div className="flex items-center gap-2 text-emerald-300 font-semibold text-base mb-5">
              <CheckCircle2 size={18} /> Import terminé — {result.fileName}
            </div>
            <div className="grid grid-cols-3 gap-4 mb-5">
              {[
                ['Affaires créées',         result.createdDeals,    '#86efac'],
                ['Mises à jour',            result.updatedDeals,    '#fde68a'],
                ['Nouvelles offres',        result.newOffers,       '#6ee7b7'],
                ['Rappelées en À appeler',  result.movedToCall,     '#c4b5fd'],
                ['Offres disparues',        result.disappearedOffers, '#fca5a5'],
                ['Erreurs',                 result.errorCount,      result.errorCount ? '#fca5a5' : '#86efac'],
              ].map(([label, value, color]) => (
                <div key={label as string}>
                  <div className="text-xs text-emerald-400 mb-0.5">{label}</div>
                  <div className="text-2xl font-bold" style={{ color: color as string }}>{value}</div>
                </div>
              ))}
            </div>

            {result.movedToCall > 0 && (
              <div className="bg-emerald-800 rounded-xl px-4 py-3 text-xs text-emerald-200 mb-4">
                <strong>{result.movedToCall} affaire{result.movedToCall > 1 ? 's' : ''}</strong> avec de nouvelles offres ont été automatiquement replacées
                dans <strong>« À appeler »</strong>. Leur colonne précédente est mémorisée dans la fiche affaire.
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="bg-red-900 border border-red-700 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-2 text-red-300 text-xs font-semibold mb-2">
                  <AlertCircle size={13} /> {result.errors.length} erreur{result.errors.length > 1 ? 's' : ''}
                </div>
                {result.errors.slice(0, 5).map((e, i) => (
                  <div key={i} className="text-xs text-red-300">Ligne {e.row}: {e.message}</div>
                ))}
              </div>
            )}

            <button className="btn-secondary text-xs" onClick={() => setResult(null)}>Faire un autre import</button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
