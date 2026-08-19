'use client';
import { useState } from 'react';

// Pop-up « Date de closing » affichée quand une affaire est déposée dans la
// colonne « SMARTLINKÉ ».
//
// Elle propose un champ par abonnement RESTANT À DATER — jamais pour un
// abonnement dont la date de closing est déjà renseignée. Une affaire qui
// décroche un second contrat ne doit pas se voir proposer, ni écraser, la date
// du contrat en cours.
//
// La pop-up ne fait QUE l'UI ; le déplacement est géré par le parent pour
// pouvoir annuler proprement.

/** Un abonnement à dater. `subscriptionId` est null quand l'affaire n'en a
 *  encore aucun : la validation en créera un. */
export interface ClosingTarget {
  subscriptionId: string | null;
  /** Intitulé affiché au-dessus du champ. Vide s'il n'y a rien d'utile à dire. */
  label: string;
}

export interface ClosingDateEntry {
  subscriptionId: string | null;
  /** "YYYY-MM-DD", ou '' si laissé vide. */
  date: string;
}

/** Utilisateur proposé dans la liste « Closé par ». */
export interface ClosingUser { id: string; name: string; color?: string }

interface Props {
  storeName?: string;
  targets: ClosingTarget[];
  /** Comptes proposés dans la liste déroulante « Closé par ». */
  users: ClosingUser[];
  onConfirm: (entries: ClosingDateEntry[], closedBy: ClosingUser | null) => Promise<void>;
  onCancel: () => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid #e2e8f0',
  background: '#fff', color: '#0f172a', fontSize: 14, outline: 'none',
};

export default function ClosingDateModal({ storeName, targets, users, onConfirm, onCancel }: Props) {
  // Les champs partent TOUJOURS vides : ces abonnements n'ont pas de date, et
  // pré-remplir avec celle d'un autre abonnement était précisément le défaut.
  const [dates, setDates] = useState<string[]>(() => targets.map(() => ''));
  // Volontairement vide au départ : le closeur n'est pas forcément celui qui
  // déplace la carte, c'est tout l'intérêt de le demander.
  const [closedById, setClosedById] = useState('');
  const [loading, setLoading] = useState(false);

  const setAt = (index: number, value: string) =>
    setDates(prev => prev.map((d, i) => (i === index ? value : d)));

  const confirm = async () => {
    setLoading(true);
    try {
      await onConfirm(
        targets.map((t, i) => ({ subscriptionId: t.subscriptionId, date: dates[i] })),
        users.find(u => u.id === closedById) ?? null,
      );
    } catch {
      // Le parent affiche le toast d'erreur ; on réactive le bouton.
      setLoading(false);
    }
  };

  const multiple = targets.length > 1;

  return (
    <div
      onClick={loading ? undefined : onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: '#0f172a' }}>
          📅 {multiple ? 'Dates de closing' : 'Date de closing'}
        </div>
        <p style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.5, marginBottom: 16 }}>
          {multiple ? (
            <>
              Renseigne la <b>date de closing</b> des abonnements qui n&apos;en ont pas encore
              {storeName ? <> pour <b>{storeName}</b></> : null}, avant de placer l&apos;affaire dans <b>SMARTLINKÉ</b>.
            </>
          ) : (
            <>
              Renseigne la <b>date de closing</b>{storeName ? <> pour <b>{storeName}</b></> : null} avant de placer l&apos;affaire dans <b>SMARTLINKÉ</b>.
            </>
          )}
        </p>

        {targets.map((target, index) => (
          <div key={target.subscriptionId ?? `new-${index}`} style={{ marginBottom: 14 }}>
            {target.label && (
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#64748b', marginBottom: 5 }}>
                {target.label}
              </label>
            )}
            <input
              type="date"
              autoFocus={index === 0}
              value={dates[index]}
              onChange={e => setAt(index, e.target.value)}
              disabled={loading}
              style={inputStyle}
            />
          </div>
        ))}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#64748b', marginBottom: 5 }}>
            Closé par
          </label>
          <select
            value={closedById}
            onChange={e => setClosedById(e.target.value)}
            disabled={loading}
            style={{ ...inputStyle, cursor: loading ? 'wait' : 'pointer' }}
          >
            <option value="">— Sélectionner —</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
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
