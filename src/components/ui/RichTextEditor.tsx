'use client';
import { useRef, useEffect, useCallback } from 'react';

// Éditeur de texte riche (WYSIWYG) basé sur contentEditable + execCommand.
// Produit du HTML compatible email (<b>, <i>, <u>, <ul>, <font>…). Réutilisé
// par l'éditeur de template (Paramètres) et le composer email du deal.

interface Props {
  value: string;
  onChange: (html: string) => void;
  /** Variables {{…}} insérables au curseur (optionnel). */
  variables?: string[];
  placeholder?: string;
  minHeight?: number;
}

const FONTS = ['Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Courier New'];

function looksHtml(s: string) { return /<[a-z][\s\S]*>/i.test(s || ''); }
function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** Normalise une valeur entrante : le texte simple (anciens templates) est
 *  converti en HTML pour s'afficher correctement dans l'éditeur. */
function normalize(value: string) {
  if (!value) return '';
  return looksHtml(value) ? value : escapeHtml(value).replace(/\n/g, '<br>');
}

const tbBtn: React.CSSProperties = {
  minWidth: 28, height: 28, padding: '0 7px', borderRadius: 6, border: '1px solid #e2e8f0',
  background: '#fff', color: '#334155', cursor: 'pointer', fontSize: 13,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
const sep: React.CSSProperties = { width: 1, height: 18, background: '#e2e8f0', margin: '0 2px' };

export default function RichTextEditor({ value, onChange, variables, placeholder, minHeight = 180 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  // Dernier HTML émis par l'éditeur : sert à ne PAS re-traiter (ré-échapper) le
  // contenu qui provient de la frappe (sinon « &nbsp; » devient « &amp;nbsp; »).
  const lastHtml = useRef<string | null>(null);

  // Synchronise le DOM uniquement quand la valeur vient de l'extérieur
  // (ex. application d'un template), sans casser le curseur pendant la frappe.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value === lastHtml.current) return; // provient de l'éditeur : ne rien faire
    const incoming = normalize(value);
    if (incoming !== el.innerHTML) el.innerHTML = incoming;
    lastHtml.current = value;
  }, [value]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    lastHtml.current = el.innerHTML;
    onChange(el.innerHTML);
  }, [onChange]);

  // Mémorise la sélection courante tant qu'elle est dans l'éditeur, pour la
  // restaurer avant d'appliquer une commande (les selects volent le focus).
  const saveSel = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ref.current && ref.current.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  const restoreSel = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  }, []);

  const exec = (command: string, arg?: string) => {
    restoreSel();
    document.execCommand(command, false, arg);
    saveSel();
    emit();
  };

  const insertVariable = (text: string) => {
    restoreSel();
    document.execCommand('insertText', false, text);
    saveSel();
    emit();
  };

  const addLink = () => {
    const url = window.prompt('URL du lien :', 'https://');
    if (url) exec('createLink', url);
  };

  const isEmpty = normalize(value).replace(/<br\s*\/?>/gi, '').replace(/<[^>]*>/g, '').trim() === '';

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
      {/* Barre d'outils */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, padding: 6, borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
        <button type="button" title="Gras" onClick={() => exec('bold')} style={{ ...tbBtn, fontWeight: 700 }}>B</button>
        <button type="button" title="Italique" onClick={() => exec('italic')} style={{ ...tbBtn, fontStyle: 'italic' }}>I</button>
        <button type="button" title="Souligné" onClick={() => exec('underline')} style={{ ...tbBtn, textDecoration: 'underline' }}>U</button>
        <span style={sep} />
        <button type="button" title="Liste à puces" onClick={() => exec('insertUnorderedList')} style={tbBtn}>•&nbsp;≡</button>
        <button type="button" title="Liste numérotée" onClick={() => exec('insertOrderedList')} style={tbBtn}>1.</button>
        <button type="button" title="Insérer un lien" onClick={addLink} style={tbBtn}>🔗</button>
        <span style={sep} />
        <select title="Police" onChange={e => { const v = e.target.value; e.target.selectedIndex = 0; exec('fontName', v); }} style={{ ...tbBtn, width: 'auto', padding: '0 4px' }} defaultValue="">
          <option value="" disabled>Police</option>
          {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select title="Taille" onChange={e => { const v = e.target.value; e.target.selectedIndex = 0; exec('fontSize', v); }} style={{ ...tbBtn, width: 'auto', padding: '0 4px' }} defaultValue="">
          <option value="" disabled>Taille</option>
          <option value="2">Petit</option>
          <option value="3">Normal</option>
          <option value="5">Grand</option>
          <option value="6">Très grand</option>
        </select>
        <button type="button" title="Effacer la mise en forme" onClick={() => exec('removeFormat')} style={tbBtn}>T̲ₓ</button>
      </div>

      {/* Variables insérables */}
      {variables && variables.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 6px 0' }}>
          {variables.map(v => (
            <button key={v} type="button" onClick={() => insertVariable(v)}
              style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 999, border: '1px solid #c7d2fe', background: '#eef2ff', color: '#4338ca', cursor: 'pointer' }}>
              {v}
            </button>
          ))}
        </div>
      )}

      {/* Zone éditable */}
      <div style={{ position: 'relative' }}>
        {isEmpty && placeholder && (
          <div style={{ position: 'absolute', top: 10, left: 12, color: '#cbd5e1', fontSize: 13, pointerEvents: 'none', whiteSpace: 'pre-wrap' }}>{placeholder}</div>
        )}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={() => { saveSel(); emit(); }}
          onKeyUp={saveSel}
          onMouseUp={saveSel}
          onBlur={emit}
          style={{ minHeight, padding: '10px 12px', fontSize: 13, lineHeight: 1.5, color: '#0f172a', outline: 'none' }}
        />
      </div>
    </div>
  );
}
