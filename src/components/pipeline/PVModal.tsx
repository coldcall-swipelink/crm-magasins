'use client';
import { useState } from 'react';

// Pop-up « Prospection de Valeur » affichée quand une affaire est déposée dans
// « Démo prévue » (pipeline Prospection). Le board décide quoi faire :
//   - onConfirm('oui') → persiste le déplacement puis duplique vers Recrutement
//   - onConfirm('non') → persiste le déplacement puis duplique vers Closing
//   - onCancel()       → annule : l'affaire repart dans sa colonne d'origine
//
// La pop-up ne fait QUE l'UI ; toute la logique (move + duplication) est gérée
// par le parent pour pouvoir annuler proprement.

interface Props {
  onConfirm: (choice: 'oui' | 'non') => Promise<void>;
  onCancel: () => void;
}

export default function PVModal({ onConfirm, onCancel }: Props) {
  const [loading, setLoading] = useState<'oui' | 'non' | null>(null);

  const choose = async (choice: 'oui' | 'non') => {
    setLoading(choice);
    try {
      await onConfirm(choice);
    } catch {
      // Le parent affiche le toast d'erreur ; on réactive les boutons.
      setLoading(null);
    }
  };

  const btn = (color: string, dim: boolean): React.CSSProperties => ({
    flex: 1, padding: '11px', borderRadius: 9, border: 'none', background: color,
    color: '#fff', fontWeight: 700, fontSize: 14, cursor: loading ? 'wait' : 'pointer',
    opacity: dim ? 0.6 : 1,
  });

  return (
    <div
      onClick={loading ? undefined : onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: 470, maxWidth: '100%', background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: '#0f172a' }}>
          🎯 Prospection de Valeur ?
        </div>
        <p style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.5, marginBottom: 10 }}>
          Cette affaire correspond-elle à une <b>Prospection de Valeur (PV)</b> ?
        </p>
        <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.55, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginBottom: 18 }}>
          Une <b>PV</b> consiste à offrir <b>gratuitement des profils</b> (candidats) au magasin,
          afin de démontrer la valeur de notre service avant la vente.
          <div style={{ marginTop: 8 }}>
            • <b>OUI</b> → l'affaire est transférée dans <b>Closing › DEMO PREVUE</b> et dupliquée dans <b>Recrutement › SOURCING A FAIRE</b> (on lance le sourcing).<br />
            • <b>NON</b> → l'affaire est transférée dans <b>Closing › DEMO PREVUE</b>.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => choose('oui')} disabled={loading !== null} style={btn('#16a34a', loading === 'non')}>
            {loading === 'oui' ? '…' : 'OUI'}
          </button>
          <button onClick={() => choose('non')} disabled={loading !== null} style={btn('#4f46e5', loading === 'oui')}>
            {loading === 'non' ? '…' : 'NON'}
          </button>
        </div>
        <button
          onClick={onCancel}
          disabled={loading !== null}
          style={{ marginTop: 10, width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          Annuler (laisser l'affaire dans sa colonne d'origine)
        </button>
      </div>
    </div>
  );
}
