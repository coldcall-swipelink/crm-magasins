'use client';
// src/components/campaigns/LeadImportModal.tsx
//
// Import de leads en deux temps : on dépose le fichier, on VOIT ce que le CRM
// a compris (correspondance des colonnes, volume, doublons, lignes fautives),
// on corrige si besoin, et seulement ensuite on importe.
//
// Toute colonne non reconnue devient un champ personnalisé — donc une variable
// utilisable dans les emails ({{effectif}}) — plutôt que d'être jetée.

import { useRef, useState } from 'react';
import { toast } from '@/components/ui/Toast';

const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: 13, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnDef: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 };

type Field = { key: string; label: string; required: boolean };
type Preview = {
  filename: string; separator: string; headers: string[];
  mapping: Record<string, string>; fields: Field[];
  sample: Record<string, string>[];
  stats: { rows: number; valid: number; invalid: number; duplicates: number; known: number; new: number };
};

export default function LeadImportModal({ userName, campaignId, onClose, onDone }: {
  userName?: string;
  /** Renseigné : les leads du fichier sont inscrits dans cette campagne. */
  campaignId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [source, setSource] = useState('');
  const [updateExisting, setUpdateExisting] = useState(true);
  const [busy, setBusy] = useState(false);

  const analyse = async (text: string, name: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/campaigns/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: name, content: text }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Fichier illisible', 'error'); return; }
      setPreview(data);
      setMapping(data.mapping);
      setSource(name.replace(/\.[^.]+$/, ''));
    } finally {
      setBusy(false);
    }
  };

  /** Au-delà, la requête dépasse la taille admise par l'hébergeur (4,5 Mo). */
  const MAX_BYTES = 4_000_000;

  const onFile = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast(`Fichier trop lourd (${Math.round(file.size / 1_000_000)} Mo, maximum 4 Mo). `
        + 'Découpez-le en plusieurs fichiers.', 'error');
      return;
    }
    const text = await file.text();
    setContent(text);
    setFilename(file.name);
    analyse(text, file.name);
  };

  const run = async () => {
    if (!Object.values(mapping).includes('email')) {
      toast("Associez une colonne au champ « Email » : c'est l'identifiant du lead.", 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/campaigns/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content, mapping, source, updateExisting, commit: true, userName, campaignId }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Import impossible', 'error'); return; }
      const r = data.report;
      toast(`${r.created} lead(s) créé(s), ${r.updated} mis à jour, ${r.skipped} ignoré(s)`);
      if (data.enrollError) toast(`Import fait, mais inscription impossible : ${data.enrollError}`, 'error');
      else if (data.enrolled) {
        toast(`${data.enrolled.enrolled} lead(s) inscrit(s) dans la campagne`
          + (data.enrolled.skipped ? ` · ${data.enrolled.skipped} écarté(s)` : ''));
      }
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const stats = preview?.stats;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 24 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(980px, 100%)', maxHeight: '90vh', overflow: 'auto', padding: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
          {campaignId ? 'Importer des leads dans la campagne' : 'Importer des leads'}
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
          Fichier CSV ou TSV, avec une ligne d&apos;en-tête. Seul l&apos;email est obligatoire ;
          les autres colonnes deviennent des variables de personnalisation.
          {campaignId && ' Les leads du fichier seront inscrits dans la campagne dans la foulée.'}
        </div>

        {!preview ? (
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) onFile(file); }}
            onClick={() => fileRef.current?.click()}
            style={{ border: '1px dashed #cbd5e1', borderRadius: 12, padding: 40, textAlign: 'center', cursor: 'pointer', background: '#f8fafc' }}
          >
            <div style={{ fontSize: 13, color: '#475569' }}>
              {busy ? 'Analyse du fichier…' : 'Glissez un fichier ici, ou cliquez pour le choisir'}
            </div>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" style={{ display: 'none' }}
              onChange={e => { const file = e.target.files?.[0]; if (file) onFile(file); }} />
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <Stat label="Lignes" value={stats!.rows} />
              <Stat label="Emails valides" value={stats!.valid} />
              <Stat label="Nouveaux" value={stats!.new < 0 ? 0 : stats!.new} accent />
              <Stat label="Déjà connus" value={stats!.known} />
              <Stat label="Doublons internes" value={stats!.duplicates} />
              <Stat label="Emails invalides" value={stats!.invalid} warn={stats!.invalid > 0} />
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', letterSpacing: '.6px', textTransform: 'uppercase', marginBottom: 8 }}>
              Correspondance des colonnes
            </div>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                    <th style={{ padding: '8px 12px', fontWeight: 600, color: '#64748b' }}>Colonne du fichier</th>
                    <th style={{ padding: '8px 12px', fontWeight: 600, color: '#64748b' }}>Exemple</th>
                    <th style={{ padding: '8px 12px', fontWeight: 600, color: '#64748b', width: 260 }}>Champ du lead</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.headers.map(header => {
                    const target = mapping[header] || '';
                    const custom = target.startsWith('custom:');
                    return (
                      <tr key={header} style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '7px 12px', fontWeight: 500 }}>{header}</td>
                        <td style={{ padding: '7px 12px', color: '#94a3b8', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {preview.sample[0]?.[header] || '—'}
                        </td>
                        <td style={{ padding: '5px 12px' }}>
                          <select
                            style={{ ...inp, padding: '5px 8px', fontSize: 12.5 }}
                            value={custom ? 'custom' : target}
                            onChange={e => {
                              const value = e.target.value;
                              setMapping(m => ({
                                ...m,
                                [header]: value === 'custom' ? `custom:${slug(header)}` : value,
                              }));
                            }}
                          >
                            <option value="">— Ignorer cette colonne —</option>
                            {preview.fields.map(field => (
                              <option key={field.key} value={field.key}>
                                {field.label}{field.required ? ' (obligatoire)' : ''}
                              </option>
                            ))}
                            <option value="custom">Champ personnalisé {`{{${slug(header)}}}`}</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={label}>Provenance (rangée sur chaque lead)</label>
                <input style={inp} value={source} onChange={e => setSource(e.target.value)} placeholder="Ex : Salon Franchise 2026" />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#475569', alignSelf: 'end', paddingBottom: 8 }}>
                <input type="checkbox" checked={updateExisting} onChange={e => setUpdateExisting(e.target.checked)} />
                Compléter les leads déjà connus (sans jamais effacer une valeur existante)
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...btnPri, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={run}>
                {busy ? 'Import en cours…' : `Importer ${stats!.valid} lead(s)`}
              </button>
              <button style={btnDef} onClick={() => { setPreview(null); setContent(''); }}>Changer de fichier</button>
              <button style={{ ...btnDef, marginLeft: 'auto' }} onClick={onClose}>Annuler</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent, warn }: { label: string; value: number; accent?: boolean; warn?: boolean }) {
  const color = warn ? '#b91c1c' : accent ? '#4338ca' : '#0f172a';
  const bg = warn ? '#fef2f2' : accent ? '#eef2ff' : '#f8fafc';
  return (
    <div style={{ background: bg, border: '1px solid #e2e8f0', borderRadius: 9, padding: '8px 14px', minWidth: 110 }}>
      <div style={{ fontSize: 17, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 10.5, color: '#64748b' }}>{label}</div>
    </div>
  );
}

/** Même règle que côté serveur (customFieldSlug), pour afficher le nom de la
 *  variable au moment où l'utilisateur choisit « champ personnalisé ». */
function slug(header: string): string {
  return header.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'champ';
}
