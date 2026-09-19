'use client';
// src/components/campaigns/DealImportModal.tsx
//
// Reprise des contacts du CRM comme leads.
//
// Les affaires du pipeline portent déjà l'enseigne, le magasin, l'email, la
// civilité et le nom du contact. Cet écran les reprend en un geste, en
// montrant d'abord ce qui sera écrit : combien d'affaires, combien d'adresses
// distinctes, combien sont déjà des leads.
//
// Le périmètre se règle par pipeline, puis par colonnes de ce pipeline (autant
// qu'on veut à la fois), puis par enseigne. Les colonnes sont le garde-fou :
// on ne reprend pas les affaires « en contact » ou « à relancer » quand on ne
// veut écrire qu'à celles qu'on n'a pas encore jointes.

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { T, btnDef, btnPri, chip, inp, label, modal, overlay } from './ui';

type Sample = {
  email: string; civility: string; lastName: string; contactCalling: string;
  company: string; jobTitle: string; city: string; store: string;
};

type Preview = {
  deals: number; withEmail: number; unique: number; known: number; fresh: number;
  sample: Sample[];
  pipelines: Array<{ id: string; name: string; deals: number }>;
  columns: Array<{ id: string; title: string; color: string; deals: number }>;
  brands: Array<{ id: string; name: string; deals: number }>;
};

/** Correspondance appliquée, affichée telle quelle : aucune surprise. */
const MAPPING = [
  ['Email du contact', 'Email'],
  ['Civilité', 'Civilité'],
  ['Nom du contact', 'Nom'],
  ['Contact calling', 'Contact calling'],
  ['Enseigne du magasin', 'Enseigne'],
  ['Nom du magasin', 'Champ personnalisé {{magasin}}'],
  ['Fonction du contact', 'Poste'],
  ['Ville du magasin', 'Ville'],
];

export default function DealImportModal({ userName, campaignId, onClose, onDone }: {
  userName?: string;
  /** Renseigné : les leads repris sont inscrits dans cette campagne. */
  campaignId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pipelineId, setPipelineId] = useState('');
  // Colonnes retenues dans le pipeline choisi. Vide = toutes.
  const [columnIds, setColumnIds] = useState<string[]>([]);
  const [brandId, setBrandId] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (pipelineId) params.set('pipelineId', pipelineId);
    if (pipelineId && columnIds.length) params.set('columnIds', columnIds.join(','));
    if (brandId) params.set('brandId', brandId);
    const data = await fetch(`/api/campaigns/leads/import-deals?${params}`).then(res => res.json());
    setPreview(data.preview);
  }, [pipelineId, columnIds, brandId]);

  useEffect(() => { load(); }, [load]);

  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/campaigns/leads/import-deals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipelineId: pipelineId || undefined,
          columnIds: pipelineId && columnIds.length ? columnIds : undefined,
          brandId: brandId || undefined,
          onlyNew, userName, campaignId,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Reprise impossible', 'error'); return; }

      const r = data.report;
      toast(`${r.created} lead(s) créé(s), ${r.updated} complété(s), ${r.skipped} inchangé(s)`);
      if (data.enrollError) toast(`Repris, mais non inscrits : ${data.enrollError}`, 'error');
      else if (data.enrolled) toast(`${data.enrolled.enrolled} lead(s) inscrit(s) dans la campagne`);
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={event => event.stopPropagation()} style={{ ...modal, width: 'min(680px, 100%)', maxHeight: '88vh', overflow: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Importer les contacts du CRM</div>
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 16 }}>
          Les affaires du pipeline portent déjà un contact identifié. On le reprend tel quel —
          aucune ressaisie, et le lead reste rattaché à son affaire.
        </div>

        {!preview ? (
          <div style={{ fontSize: 13, color: T.textFaint, padding: '20px 0' }}>Lecture du pipeline…</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={label}>Pipeline</label>
                <select style={inp} value={pipelineId} onChange={event => {
                  setPipelineId(event.target.value);
                  // Les colonnes appartiennent au pipeline, et la liste des
                  // enseignes en dépend : une valeur absente du nouveau
                  // périmètre laisserait un filtre vide.
                  setColumnIds([]);
                  setBrandId('');
                }}>
                  <option value="">Tous les pipelines</option>
                  {preview.pipelines.map(pipeline => (
                    <option key={pipeline.id} value={pipeline.id}>
                      {pipeline.name} ({pipeline.deals} affaire{pipeline.deals > 1 ? 's' : ''})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={label}>Enseigne</label>
                <select style={inp} value={brandId} onChange={event => setBrandId(event.target.value)}>
                  <option value="">Toutes les enseignes</option>
                  {preview.brands.map(brand => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name} ({brand.deals})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <ColumnPicker
              pipelineChosen={pipelineId !== ''}
              columns={preview.columns}
              selected={columnIds}
              onChange={setColumnIds}
            />

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              <Stat label="Affaires avec email" value={preview.withEmail} hint={`sur ${preview.deals}`} />
              <Stat label="Contacts distincts" value={preview.unique} />
              <Stat label="Nouveaux leads" value={preview.fresh} accent />
              <Stat label="Déjà connus" value={preview.known} />
            </div>

            <div style={{ ...label, marginBottom: 6 }}>CE QUI SERA REPRIS</div>
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 9, marginBottom: 14, overflow: 'hidden' }}>
              {MAPPING.map(([from, to]) => (
                <div key={from} style={{ display: 'flex', gap: 10, padding: '6px 12px', fontSize: 12, borderBottom: `1px solid ${T.borderSoft}` }}>
                  <span style={{ color: T.textMuted, width: 180 }}>{from}</span>
                  <span style={{ color: T.textFaint }}>→</span>
                  <span style={{ color: T.text }}>{to}</span>
                </div>
              ))}
            </div>

            {preview.sample.length > 0 && (
              <>
                <div style={{ ...label, marginBottom: 6 }}>APERÇU</div>
                <div style={{ border: `1px solid ${T.border}`, borderRadius: 9, marginBottom: 16, overflow: 'hidden' }}>
                  {preview.sample.map(item => (
                    <div key={item.email} style={{ padding: '7px 12px', fontSize: 12, borderBottom: `1px solid ${T.borderSoft}` }}>
                      <div style={{ color: T.text }}>
                        {[item.civility, item.lastName].filter(Boolean).join(' ') || '(sans nom)'}
                        <span style={{ color: T.textFaint }}> · {item.email}</span>
                      </div>
                      <div style={{ color: T.textMuted, fontSize: 11.5, marginTop: 2 }}>
                        {[item.company, item.store, item.city].filter(Boolean).join(' · ') || '—'}
                        {item.contactCalling && (
                          <span style={{ color: T.textFaint }}> · appel : {item.contactCalling}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: T.textMuted, marginBottom: 16 }}>
              <input type="checkbox" checked={onlyNew} onChange={event => setOnlyNew(event.target.checked)} />
              N&apos;ajouter que les nouveaux contacts (laisser les leads connus strictement intacts)
            </label>

            <div style={{ fontSize: 11.5, color: T.textFaint, marginBottom: 14, lineHeight: 1.6 }}>
              Sur un lead déjà connu, seuls les champs vides sont complétés : une valeur corrigée
              à la main dans l&apos;écran Leads n&apos;est jamais écrasée.
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...btnPri, opacity: busy || preview.unique === 0 ? 0.6 : 1 }}
                disabled={busy || preview.unique === 0} onClick={run}>
                {busy ? 'Reprise en cours…' : `Importer ${onlyNew ? preview.fresh : preview.unique} contact(s)`}
              </button>
              <button style={{ ...btnDef, marginLeft: 'auto' }} onClick={onClose}>Annuler</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Choix des colonnes du pipeline, à plusieurs.
 *
 * Une pastille par colonne, dans l'ordre du tableau, avec sa couleur et son
 * volume. Aucune pastille cochée vaut « toutes les colonnes » : c'est le
 * comportement d'avant ce filtre, et celui qu'on attend en ouvrant l'écran.
 */
function ColumnPicker({ pipelineChosen, columns, selected, onChange }: {
  pipelineChosen: boolean;
  columns: Preview['columns'];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  const selectedDeals = columns
    .filter(c => selected.includes(c.id))
    .reduce((sum, c) => sum + c.deals, 0);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <label style={{ ...label, marginBottom: 0 }}>Colonnes du pipeline</label>
        {pipelineChosen && columns.length > 0 && (
          <span style={{ fontSize: 11, color: T.textFaint, marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {selected.length > 0 && (
              <span>
                {selected.length} colonne{selected.length > 1 ? 's' : ''} · {selectedDeals} affaire{selectedDeals > 1 ? 's' : ''}
              </span>
            )}
            <button type="button" onClick={() => onChange(columns.map(c => c.id))} style={linkBtn}>Toutes</button>
            <button type="button" onClick={() => onChange([])} style={linkBtn} disabled={selected.length === 0}>Aucune</button>
          </span>
        )}
      </div>

      {!pipelineChosen ? (
        <div style={{ fontSize: 12, color: T.textFaint, marginTop: 6 }}>
          Choisissez un pipeline pour ne reprendre que certaines de ses colonnes — par exemple
          laisser de côté les affaires déjà en contact.
        </div>
      ) : columns.length === 0 ? (
        <div style={{ fontSize: 12, color: T.textFaint, marginTop: 6 }}>Ce pipeline n&apos;a aucune colonne.</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {columns.map(column => {
              const active = selected.includes(column.id);
              return (
                <button
                  key={column.id}
                  type="button"
                  role="checkbox"
                  aria-checked={active}
                  onClick={() => toggle(column.id)}
                  style={{ ...chip(active), display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: column.color, flexShrink: 0, opacity: column.deals ? 1 : .4 }} />
                  <span>{column.title}</span>
                  <span style={{ color: active ? T.primaryText : T.textFaint, fontWeight: 500 }}>{column.deals}</span>
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 6 }}>
            {selected.length === 0
              ? 'Aucune colonne cochée : toutes les affaires du pipeline sont reprises.'
              : 'Seules les affaires des colonnes cochées sont reprises.'}
          </div>
        </>
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11,
  color: T.primaryText, fontFamily: 'inherit', textDecoration: 'underline',
};

function Stat({ label: text, value, hint, accent }: {
  label: string; value: number; hint?: string; accent?: boolean;
}) {
  return (
    <div style={{
      background: accent ? T.primarySoft : T.surfaceAlt,
      border: `1px solid ${accent ? 'rgba(59,113,245,.38)' : T.border}`,
      borderRadius: 9, padding: '8px 14px', minWidth: 120,
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent ? T.primaryText : T.text }}>{value}</div>
      <div style={{ fontSize: 10.5, color: T.textMuted }}>{text}</div>
      {hint && <div style={{ fontSize: 10, color: T.textFaint }}>{hint}</div>}
    </div>
  );
}
