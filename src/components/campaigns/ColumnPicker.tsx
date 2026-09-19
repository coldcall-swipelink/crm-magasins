'use client';
// src/components/campaigns/ColumnPicker.tsx
//
// Choix des colonnes d'un pipeline, à plusieurs.
//
// Une pastille par colonne, dans l'ordre du tableau, avec sa couleur et — quand
// on le connaît — son volume. Aucune pastille cochée vaut « toutes les
// colonnes » : c'est le comportement d'avant ce filtre, et celui qu'on attend
// en ouvrant l'écran. Sert à l'import depuis le CRM et au choix de leads
// existants à inscrire dans une campagne.

import { T, chip, label } from './ui';

export type ColumnOption = { id: string; title: string; color: string; deals?: number };

export default function ColumnPicker({ pipelineChosen, columns, selected, onChange, compact }: {
  /** Sans pipeline choisi, on explique à quoi sert le filtre au lieu de lister. */
  pipelineChosen: boolean;
  columns: ColumnOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Sans la phrase d'explication sous les pastilles (écrans serrés). */
  compact?: boolean;
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  const withCounts = columns.some(c => typeof c.deals === 'number');
  const selectedDeals = columns
    .filter(c => selected.includes(c.id))
    .reduce((sum, c) => sum + (c.deals ?? 0), 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <label style={{ ...label, marginBottom: 0 }}>Colonnes du pipeline</label>
        {pipelineChosen && columns.length > 0 && (
          <span style={{ fontSize: 11, color: T.textFaint, marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {selected.length > 0 && (
              <span>
                {selected.length} colonne{selected.length > 1 ? 's' : ''}
                {withCounts && ` · ${selectedDeals} affaire${selectedDeals > 1 ? 's' : ''}`}
              </span>
            )}
            <button type="button" onClick={() => onChange(columns.map(c => c.id))} style={linkBtn}>Toutes</button>
            <button type="button" onClick={() => onChange([])} style={linkBtn} disabled={selected.length === 0}>Aucune</button>
          </span>
        )}
      </div>

      {!pipelineChosen ? (
        <div style={{ fontSize: 12, color: T.textFaint, marginTop: 6 }}>
          Choisissez un pipeline pour ne retenir que certaines de ses colonnes — par exemple
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
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: column.color, flexShrink: 0, opacity: column.deals === 0 ? .4 : 1 }} />
                  <span>{column.title}</span>
                  {typeof column.deals === 'number' && (
                    <span style={{ color: active ? T.primaryText : T.textFaint, fontWeight: 500 }}>{column.deals}</span>
                  )}
                </button>
              );
            })}
          </div>
          {!compact && (
            <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 6 }}>
              {selected.length === 0
                ? 'Aucune colonne cochée : toutes les colonnes du pipeline sont retenues.'
                : 'Seules les colonnes cochées sont retenues.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11,
  color: T.primaryText, fontFamily: 'inherit', textDecoration: 'underline',
};
