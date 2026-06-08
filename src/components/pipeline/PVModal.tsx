'use client';
import { useState } from 'react';
import { toast } from '@/components/ui/Toast';

// Pop-up « Prospection de Valeur » affichée quand une affaire arrive dans
// « Démo prévue » (pipeline Prospection). Selon le choix, l'affaire est
// dupliquée :
//   OUI → Recrutement › SOURCING A FAIRE
//   NON → Closing › DEMO PREVUE

interface Props {
  dealId: string;
  onClose: () => void;
  onDone: () => void;
}

export default function PVModal({ dealId, onClose, onDone }: Props) {
  const [loading, setLoading] = useState<'oui' | 'non' | null>(null);

  const choose = async (choice: 'oui' | 'non') => {
    setLoading(choice);
    try {
      const res = await fetch(`/api/deals/${dealId}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Erreur');
      toast(
        choice === 'oui'
          ? 'Affaire dupliquée dans Recrutement › Sourcing à faire'
          : 'Affaire dupliquée dans Closing › Demo prevue',
      );
      onDone();
    } catch (e) {
      toast((e as Error).message || 'Erreur lors de la duplication', 'error');
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
      onClick={loading ? undefined : onClose}
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
            • <b>OUI</b> → l'affaire est dupliquée dans <b>Recrutement › Sourcing à faire</b> (on lance le sourcing).<br />
            • <b>NON</b> → l'affaire est dupliquée dans <b>Closing › Demo prevue</b>.
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
          onClick={onClose}
          disabled={loading !== null}
          style={{ marginTop: 10, width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
