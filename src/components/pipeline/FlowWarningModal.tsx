'use client';
import { useState } from 'react';

// Pop-up d'avertissement affichée quand une affaire est déposée dans une
// colonne qui déclenche une séquence automatique n8n (hors CRM) :
//   - « DEMO FAITE » → séquence promotionnelle (J+1, J+3, J+9) puis action d'appel
//   - « RELANCE 1 »  → séquence de relance (J+1, action J+4, J+9)
//
// La pop-up ne fait QUE l'UI : le déplacement n'est persisté (et donc le
// webhook n8n déclenché) qu'après confirmation. Annuler remet l'affaire dans sa
// colonne d'origine, sans qu'aucun mail ne parte.

export type FlowKey = 'DEMO_FAITE' | 'RELANCE_1';

interface FlowStep {
  /** Échéance, telle que la séquence n8n la programme (« J+1 à 9h »…). */
  when: string;
  kind: 'email' | 'action';
  label: string;
}

interface FlowDescription {
  emoji: string;
  columnLabel: string;
  intro: string;
  steps: FlowStep[];
}

/**
 * Contenu des séquences, à garder aligné sur les scénarios n8n.
 * `isPV` ne change que le dernier mail de la séquence « DEMO FAITE ».
 */
export function describeFlow(flow: FlowKey, isPV: boolean): FlowDescription {
  if (flow === 'DEMO_FAITE') {
    return {
      emoji: '📩',
      columnLabel: 'DEMO FAITE',
      intro: 'Déplacer cette affaire dans DEMO FAITE lance la séquence promotionnelle automatique. Trois mails partent vers le contact du magasin :',
      steps: [
        { when: 'J+1 à 9h', kind: 'email', label: 'Mail promotionnel : un crédit offert, offre valable 72 h.' },
        { when: 'J+3', kind: 'email', label: 'Rappel : l\'offre promotionnelle expire dans 24 h.' },
        {
          when: 'J+9',
          kind: 'email',
          label: isPV
            ? 'Affaire PV → mail demandant s\'ils ont pu contacter les profils transmis.'
            : 'Affaire PC → mail demandant s\'ils ont des recrutements en cours.',
        },
        { when: 'Fin de séquence', kind: 'action', label: 'Une action « appeler le magasin » est créée dans l\'affaire.' },
      ],
    };
  }

  return {
    emoji: '📞',
    columnLabel: 'RELANCE 1',
    intro: 'Déplacer cette affaire dans RELANCE 1 lance la séquence de relance automatique. Deux mails partent vers le contact du magasin :',
    steps: [
      { when: 'J+1', kind: 'email', label: 'Mail annonçant qu\'on a essayé de les appeler.' },
      { when: 'J+4', kind: 'action', label: 'Une action est créée dans l\'affaire : appeler le magasin.' },
      { when: 'J+9', kind: 'email', label: 'Mail proposant notre aide sur un recrutement en cours.' },
    ],
  };
}

interface Props {
  flow: FlowKey;
  /** Affaire en PV (Prospection de Valeur) — change le mail J+9 de DEMO FAITE. */
  isPV: boolean;
  storeName?: string;
  /** Adresse du contact : c'est elle qui recevra les mails de la séquence. */
  dealEmail?: string | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export default function FlowWarningModal({ flow, isPV, storeName, dealEmail, onConfirm, onCancel }: Props) {
  const [loading, setLoading] = useState(false);
  const f = describeFlow(flow, isPV);
  const email = dealEmail?.trim() || '';

  const confirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } catch {
      // Le parent affiche le toast d'erreur ; on réactive les boutons.
      setLoading(false);
    }
  };

  return (
    <div
      onClick={loading ? undefined : onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: 520, maxWidth: '100%', background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: '#0f172a' }}>
          {f.emoji} Séquence automatique « {f.columnLabel} »
        </div>
        <p style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.5, marginBottom: 12 }}>
          {storeName && <><b>{storeName}</b> — </>}{f.intro}
        </p>

        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginBottom: 12 }}>
          {f.steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '5px 0', borderTop: i === 0 ? 'none' : '1px solid #eef2f7' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: s.kind === 'action' ? '#b45309' : '#4338ca', background: s.kind === 'action' ? '#fef3c7' : '#eef2ff', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0, marginTop: 1 }}>
                {s.when}
              </span>
              <span style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>
                {s.kind === 'action' ? '⚑ ' : '✉ '}{s.label}
              </span>
            </div>
          ))}
        </div>

        {/* Destinataire : une affaire sans email ne recevra aucun mail. */}
        <div style={{ fontSize: 12.5, lineHeight: 1.5, borderRadius: 10, padding: '9px 12px', marginBottom: 16, ...(email
          ? { background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }
          : { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }) }}>
          {email
            ? <>Destinataire des mails : <b>{email}</b></>
            : <><b>Aucun email sur cette affaire</b> — les mails de la séquence ne pourront pas être envoyés. L&apos;action de rappel, elle, sera bien créée.</>}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{ flex: 1, padding: '11px', borderRadius: 9, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13.5, cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            Annuler
          </button>
          <button
            onClick={confirm}
            disabled={loading}
            style={{ flex: 1.4, padding: '11px', borderRadius: 9, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: loading ? 'wait' : 'pointer', opacity: loading ? .7 : 1 }}
          >
            {loading ? '…' : `Déplacer et lancer la séquence`}
          </button>
        </div>
        <p style={{ fontSize: 11.5, color: '#94a3b8', textAlign: 'center', margin: '10px 0 0', lineHeight: 1.45 }}>
          Annuler laisse l&apos;affaire dans sa colonne d&apos;origine : aucun mail n&apos;est envoyé.
        </p>
      </div>
    </div>
  );
}
