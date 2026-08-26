'use client';
import { useEffect, useState } from 'react';
import { toast } from '@/components/ui/Toast';

// Pop-up « Envoyer l'invitation Google Meet ? » affichée quand une affaire est
// déposée dans la colonne « DEMO PREVUE » (pipeline Closing).
//
// Elle reprend la date et l'heure du champ « Date de la démo » de l'affaire :
//   - OUI → le déplacement est persisté ET l'invitation Google Meet part
//           (contact de l'affaire + invité Swipelink par défaut).
//   - NON → le déplacement est persisté, aucune invitation n'est envoyée.
//   - Annuler → rien n'est persisté, l'affaire repart dans sa colonne d'origine.
//
// La date affichée reste modifiable : sans date de démo, Google ne peut pas
// créer l'événement. La corriger ici évite un aller-retour par la fiche.
// La pop-up ne fait QUE l'UI ; le déplacement est géré par le parent.

/**
 * Toast de diagnostic de la synchro visio, d'après le `meetSync` renvoyé par
 * /api/deals/[id]/move. `null`/absent = la branche Meet n'a pas été déclenchée
 * côté serveur, ce qui, quand on vient de demander l'invitation, est une
 * anomalie à voir. Partagé par le pipeline et la fiche affaire.
 */
export function reportMeetSync(meetSync: unknown) {
  const meet = meetSync as { ok?: boolean; reason?: string } | null | undefined;
  if (meet === null || meet === undefined) {
    toast('⚠ Synchro visio non déclenchée (colonne/choix non reconnus)', 'error');
  } else if (meet.ok) {
    toast('✓ Invitation Google Meet créée');
  } else {
    const why =
      meet.reason === 'no_demo_date' ? 'aucune date de démo renseignée sur l\'affaire'
      : meet.reason === 'not_configured' ? 'intégration Google Meet non configurée (variables d\'environnement)'
      : meet.reason === 'wrong_column' ? 'colonne inattendue'
      : meet.reason === 'deal_not_found' ? 'affaire introuvable'
      : `erreur Google (${meet.reason ?? 'inconnue'})`;
    toast(`Visio non créée : ${why}`, 'error');
  }
}

/** ISO → valeur d'un <input type="datetime-local"> ("YYYY-MM-DDTHH:mm"). */
function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" → ISO, ou null si vide/invalide. */
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Date de démo en toutes lettres : « mardi 3 septembre 2026 à 14:30 ». */
function humanDate(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const jour = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${jour} à ${heure}`;
}

/* ---- Icônes (SVG inline : net à toutes les tailles, aucune dépendance) ---- */

const iconBase = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const VideoIcon = ({ color, size = 20 }: { color: string; size?: number }) => (
  <svg {...iconBase} width={size} height={size} stroke={color} aria-hidden>
    <rect x="2" y="6" width="14" height="12" rx="2" />
    <path d="m22 8-6 4 6 4V8z" />
  </svg>
);

const MailIcon = ({ color }: { color: string }) => (
  <svg {...iconBase} stroke={color} aria-hidden>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m2 7 10 6 10-6" />
  </svg>
);

const AlertIcon = ({ color }: { color: string }) => (
  <svg {...iconBase} stroke={color} aria-hidden>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

const ACCENT = '#00897b';
const ACCENT_DARK = '#00695c';

interface Props {
  storeName?: string;
  /** Date de la démo de l'affaire (ISO), telle que saisie dans la fiche. */
  demoDate?: string | null;
  /** Contact de l'affaire : c'est lui qui recevra l'invitation. */
  dealEmail?: string | null;
  /**
   * @param send          true = envoyer l'invitation, false = déplacer sans rien envoyer.
   * @param newDemoDate   ISO si la date a été modifiée dans la pop-up, sinon `undefined`
   *                      (l'affaire garde sa date, on ne la réécrit pas pour rien).
   */
  onConfirm: (send: boolean, newDemoDate?: string | null) => Promise<void>;
  onCancel: () => void;
}

export default function MeetInviteModal({ storeName, demoDate, dealEmail, onConfirm, onCancel }: Props) {
  const initial = toLocalInput(demoDate);
  const [value, setValue] = useState(initial);
  const [loading, setLoading] = useState<'oui' | 'non' | null>(null);
  const email = dealEmail?.trim() || '';
  const changed = value !== initial;

  // Échap ferme la pop-up — sauf pendant l'envoi, pour ne pas laisser croire
  // qu'une invitation déjà partie a été annulée.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loading, onCancel]);

  const choose = async (send: boolean) => {
    setLoading(send ? 'oui' : 'non');
    try {
      await onConfirm(send, changed ? fromLocalInput(value) : undefined);
    } catch {
      // Le parent affiche le toast d'erreur ; on réactive les boutons.
      setLoading(null);
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
        {/* Entête pleine largeur, aux couleurs de la visio */}
        <div style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DARK})`, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 13 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <VideoIcon color="#fff" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: '#fff', letterSpacing: '-.1px' }}>
              Invitation Google Meet ?
            </div>
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.85)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {storeName ? <>{storeName} → </> : null}<b style={{ fontWeight: 700 }}>DEMO PREVUE</b>
            </div>
          </div>
        </div>

        <div style={{ padding: '18px 22px 4px' }}>
          <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.55, margin: '0 0 16px' }}>
            Voulez-vous envoyer l&apos;invitation visio pour la démo ? Elle reprend la
            date et l&apos;heure du champ <b>Date de la démo</b> de l&apos;affaire.
          </p>

          {/* Date de la démo : reprise de l'affaire, modifiable si besoin */}
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '.6px', textTransform: 'uppercase', marginBottom: 6 }}>
            Date de la démo
          </label>
          <input
            type="datetime-local"
            value={value}
            disabled={loading !== null}
            onChange={e => setValue(e.target.value)}
            style={{
              width: '100%', height: 40, padding: '0 12px', borderRadius: 10, fontSize: 14,
              border: `1px solid ${value ? '#cbd5e1' : '#fcd34d'}`, background: value ? '#fff' : '#fffbeb',
              color: '#0f172a', outline: 'none',
            }}
          />
          {value && (
            <div style={{ fontSize: 12.5, color: '#475569', marginTop: 7 }}>
              La visio sera calée sur le <b style={{ color: '#0f172a' }}>{humanDate(value)}</b>
              {changed ? <span style={{ color: '#b45309' }}> — la date de l&apos;affaire sera mise à jour.</span> : null}
            </div>
          )}

          {/* Destinataire : sans date ou sans email, l'invitation ne part pas. */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 14, borderRadius: 11, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5, ...(value && email
            ? { background: '#f8fafc', border: '1px solid #e8ecf3', color: '#475569' }
            : { background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }) }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}>
              {value && email ? <MailIcon color="#94a3b8" /> : <AlertIcon color="#d97706" />}
            </span>
            <span style={{ minWidth: 0 }}>
              {!value
                ? <><b>Aucune date de démo</b> — renseignez-la ci-dessus pour pouvoir envoyer l&apos;invitation.</>
                : email
                  ? <>Invitation envoyée à <b style={{ color: '#0f172a' }}>{email}</b> et à l&apos;équipe Swipelink.</>
                  : <><b>Aucun email sur cette affaire</b> — la visio sera créée avec le seul invité Swipelink.</>}
            </span>
          </div>
        </div>

        {/* Pied : les deux issues, et ce qu'implique l'annulation */}
        <div style={{ marginTop: 18, padding: '14px 22px 16px', background: '#f8fafc', borderTop: '1px solid #eef2f7' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => choose(false)}
              disabled={loading !== null}
              style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid #dde3ec', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13.5, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading === 'oui' ? .6 : 1 }}
            >
              {loading === 'non' ? 'Déplacement…' : 'Non, ne rien envoyer'}
            </button>
            <button
              onClick={() => choose(true)}
              disabled={loading !== null || !value}
              title={!value ? 'Renseignez la date de la démo pour envoyer l’invitation' : undefined}
              style={{
                flex: 1.5, padding: '11px', borderRadius: 10, border: 'none',
                background: !value ? '#cbd5e1' : loading ? ACCENT_DARK : `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DARK})`,
                color: '#fff', fontWeight: 700, fontSize: 13.5,
                cursor: !value ? 'not-allowed' : loading ? 'wait' : 'pointer',
                boxShadow: value ? `0 2px 8px ${ACCENT}45` : 'none',
                opacity: loading === 'non' ? .6 : 1,
              }}
            >
              {loading === 'oui' ? 'Envoi…' : 'Oui, envoyer une invitation'}
            </button>
          </div>
          <button
            onClick={onCancel}
            disabled={loading !== null}
            style={{ marginTop: 10, width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            Annuler (laisser l&apos;affaire dans sa colonne d&apos;origine)
          </button>
        </div>
      </div>
    </div>
  );
}
