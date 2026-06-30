'use client';
import { useState } from 'react';

// Pop-up « Date de closing » affichée quand une affaire est déposée dans la
// colonne « SMARTLINKÉ ». Le board décide quoi faire :
//   - onConfirm(date) → persiste le déplacement avec la date de closing
//                       (date = "YYYY-MM-DD" ou '' si laissée vide)
//   - onCancel()      → annule : l'affaire repart dans sa colonne d'origine
//
// La pop-up ne fait QUE l'UI ; le déplacement est géré par le parent pour
// pouvoir annuler proprement.

interface Props {
  storeName?: string;
  initialDate?: string; // "YYYY-MM-DD"
  onConfirm: (date: string) => Promise<void>;
  onCancel: () => void;
}

export default function ClosingDateModal({ storeName, initialDate, onConfirm, onCancel }: Props) {
  const [date, setDate] = useState(initialDate ?? '');
  const [loading, setLoading] = useState(false);

  const confirm = async () => {
    setLoading(true);
    try {
      await onConfirm(date);
    } catch {
      // Le parent affiche le toast d'erreur ; on réactive le bouton.
      setLoading(false);
    }
  };

  return (
    <div
      onClick={loading ? undefined : onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: '#0f172a' }}>
          📅 Date de closing
        </div>
        <p style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.5, marginBottom: 16 }}>
          Renseigne la <b>date de closing</b>{storeName ? <> pour <b>{storeName}</b></> : null} avant de placer l&apos;affaire dans <b>SMARTLINKÉ</b>.
        </p>
        <input
          type="date"
          autoFocus
          value={date}
          onChange={e => setDate(e.target.value)}
          disabled={loading}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a', fontSize: 14, outline: 'none', marginBottom: 18 }}
        />
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={confirm}
            disabled={loading}
            style={{ flex: 1, padding: '11px', borderRadius: 9, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 14, cursor: loading ? 'wait' : 'pointer' }}
          >
            {loading ? '…' : 'Valider'}
          </button>
        </div>
        <button
          onClick={onCancel}
          disabled={loading}
          style={{ marginTop: 10, width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          Annuler (laisser l&apos;affaire dans sa colonne d&apos;origine)
        </button>
      </div>
    </div>
  );
}
