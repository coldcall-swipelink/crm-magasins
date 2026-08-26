'use client';
import { useEffect, useState } from 'react';
import type { FlowKey } from '@/lib/pipelineStages';

// Pop-up d'avertissement affichée quand une affaire est déposée dans une
// colonne qui déclenche une séquence automatique n8n (hors CRM) :
//   - « DEMO FAITE » → séquence promotionnelle (J+1, J+3, J+9) puis action d'appel
//   - « RELANCE 1 »  → séquence de relance (J+1, action J+4, J+9)
//
// La pop-up ne fait QUE l'UI : le déplacement n'est persisté (et donc le
// webhook n8n déclenché) qu'après confirmation. Annuler remet l'affaire dans sa
// colonne d'origine, sans qu'aucun mail ne parte.

// Le vocabulaire des étapes est partagé (pipeline + frise de la fiche) ; on le
// ré-exporte pour que l'import de la pop-up suffise à typer son `flow`.
export type { FlowKey };

interface FlowStep {
  /** Échéance, telle que la séquence n8n la programme (« J+1 à 9h »…). */
  when: string;
  kind: 'email' | 'action';
  label: string;
}

interface FlowDescription {
  columnLabel: string;
  intro: string;
  /** Couleur d'accent de la séquence (entête + jalons « mail »). */
  accent: string;
  accentDark: string;
  steps: FlowStep[];
}

/**
 * Contenu des séquences, à garder aligné sur les scénarios n8n.
 * `isPV` ne change que le dernier mail de la séquence « DEMO FAITE ».
 */
export function describeFlow(flow: FlowKey, isPV: boolean): FlowDescription {
  if (flow === 'DEMO_FAITE') {
    return {
      columnLabel: 'DEMO FAITE',
      intro: 'Trois mails partent automatiquement vers le contact du magasin, puis une action est créée dans l’affaire.',
      accent: '#6366f1',
      accentDark: '#4338ca',
      steps: [
        { when: 'J+1 · 9h', kind: 'email', label: 'Mail promotionnel : un crédit offert, offre valable 72 h.' },
        { when: 'J+3', kind: 'email', label: 'Rappel : l’offre promotionnelle expire dans 24 h.' },
        {
          when: 'J+9',
          kind: 'email',
          label: isPV
            ? 'Affaire PV — ont-ils pu contacter les profils transmis ?'
            : 'Affaire PC — ont-ils des recrutements en cours ?',
        },
        { when: 'Fin de séquence', kind: 'action', label: 'Action « appeler le magasin » créée dans l’affaire.' },
      ],
    };
  }

  return {
    columnLabel: 'RELANCE 1',
    intro: 'Deux mails partent automatiquement vers le contact du magasin, et une action de rappel est créée entre les deux.',
    accent: '#0ea5e9',
    accentDark: '#0369a1',
    steps: [
      { when: 'J+1', kind: 'email', label: 'Mail annonçant qu’on a essayé de les appeler.' },
      { when: 'J+4', kind: 'action', label: 'Action créée dans l’affaire : appeler le magasin.' },
      { when: 'J+9', kind: 'email', label: 'Mail proposant notre aide sur un recrutement en cours.' },
    ],
  };
}

/* ---- Icônes (SVG inline : net à toutes les tailles, aucune dépendance) ---- */

const iconBase = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const MailIcon = ({ color }: { color: string }) => (
  <svg {...iconBase} stroke={color} aria-hidden>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m2 7 10 6 10-6" />
  </svg>
);

const PhoneIcon = ({ color }: { color: string }) => (
  <svg {...iconBase} stroke={color} aria-hidden>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.6 2.8a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.2-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.8.6a2 2 0 0 1 1.7 2Z" />
  </svg>
);

const SendIcon = ({ color, size = 20 }: { color: string; size?: number }) => (
  <svg {...iconBase} width={size} height={size} stroke={color} aria-hidden>
    <path d="M22 2 11 13" />
    <path d="M22 2l-7 20-4-9-9-4 20-7z" />
  </svg>
);

const AlertIcon = ({ color }: { color: string }) => (
  <svg {...iconBase} stroke={color} aria-hidden>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

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

  // Échap ferme la pop-up — sauf pendant l'envoi, pour ne pas laisser croire
  // qu'un déplacement déjà parti a été annulé.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loading, onCancel]);

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
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: 500, maxWidth: '100%', background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 24px 70px rgba(15,23,42,.35)' }}
      >
        {/* Entête pleine largeur, aux couleurs de la séquence */}
        <div style={{ background: `linear-gradient(135deg, ${f.accent}, ${f.accentDark})`, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 13 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <SendIcon color="#fff" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: '#fff', letterSpacing: '-.1px' }}>
              Séquence automatique
            </div>
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.85)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {storeName ? <>{storeName} → </> : null}<b style={{ fontWeight: 700 }}>{f.columnLabel}</b>
            </div>
          </div>
        </div>

        <div style={{ padding: '18px 22px 4px' }}>
          <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.55, margin: '0 0 18px' }}>
            {f.intro}
          </p>

          {/* Frise : un jalon par étape, reliés par un filet vertical */}
          <div style={{ position: 'relative', paddingLeft: 46 }}>
            <div style={{ position: 'absolute', left: 15, top: 14, bottom: 20, width: 2, background: '#e8ecf3', borderRadius: 2 }} />
            {f.steps.map((s, i) => {
              const isAction = s.kind === 'action';
              const color = isAction ? '#d97706' : f.accent;
              return (
                <div key={i} style={{ position: 'relative', paddingBottom: i === f.steps.length - 1 ? 4 : 16 }}>
                  <div style={{ position: 'absolute', left: -46, top: 0, width: 32, height: 32, borderRadius: 11, background: '#fff', border: `1.5px solid ${isAction ? '#fcd34d' : '#dfe3f5'}`, boxShadow: `0 1px 3px rgba(15,23,42,.06)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isAction ? <PhoneIcon color={color} /> : <MailIcon color={color} />}
                  </div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color, letterSpacing: '.7px', marginBottom: 3 }}>
                    {s.when}
                  </div>
                  <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.5 }}>
                    {s.label}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Destinataire : une affaire sans email ne recevra aucun mail. */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 18, borderRadius: 11, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5, ...(email
            ? { background: '#f8fafc', border: '1px solid #e8ecf3', color: '#475569' }
            : { background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }) }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}>
              {email ? <MailIcon color="#94a3b8" /> : <AlertIcon color="#d97706" />}
            </span>
            <span style={{ minWidth: 0 }}>
              {email
                ? <>Destinataire des mails : <b style={{ color: '#0f172a' }}>{email}</b></>
                : <><b>Aucun email sur cette affaire</b> — les mails ne pourront pas être envoyés. L&apos;action de rappel, elle, sera bien créée.</>}
            </span>
          </div>
        </div>

        {/* Pied : les deux issues, et ce qu'implique l'annulation */}
        <div style={{ marginTop: 18, padding: '14px 22px 16px', background: '#f8fafc', borderTop: '1px solid #eef2f7' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onCancel}
              disabled={loading}
              style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid #dde3ec', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13.5, cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              Annuler
            </button>
            <button
              onClick={confirm}
              disabled={loading}
              style={{ flex: 1.5, padding: '11px', borderRadius: 10, border: 'none', background: loading ? f.accentDark : `linear-gradient(135deg, ${f.accent}, ${f.accentDark})`, color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: loading ? 'wait' : 'pointer', boxShadow: `0 2px 8px ${f.accent}45`, opacity: loading ? .8 : 1 }}
            >
              {loading ? 'Déplacement…' : 'Déplacer et lancer la séquence'}
            </button>
          </div>
          <p style={{ fontSize: 11.5, color: '#94a3b8', textAlign: 'center', margin: '9px 0 0', lineHeight: 1.45 }}>
            Annuler laisse l&apos;affaire dans sa colonne d&apos;origine — aucun mail n&apos;est envoyé.
          </p>
        </div>
      </div>
    </div>
  );
}
