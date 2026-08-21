'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/lib/currentUser';

// Pop-up du matin : les relances « lien de paiement » à valider.
//
// Une affaire déposée dans « LIEN PAIEMENT ENVOYÉ » qui n'a pas bougé au bout
// du délai paramétré (7 jours par défaut) arrive ici. Rien ne part tout seul :
// le mail n'est envoyé qu'après un clic sur « Relancer ».
//
// La pop-up ne s'affiche que pour Hugo Abdelhadi et Bilal Yacouti — c'est le
// serveur qui tranche (`allowed`), le composant ne fait que suivre. Tous deux
// voient la MÊME file, décisions comprises : dès que l'un valide ou refuse une
// relance, elle bascule chez l'autre dans « Déjà traité », avec son nom.
//
// Elle s'ouvre d'elle-même à la première visite de la journée, puis reste
// accessible via la pastille en bas à droite tant qu'il reste des relances.

interface FollowUpItem {
  id: string;
  dealId: string;
  storeName: string;
  brandName: string;
  city: string;
  contactName: string;
  enteredAt: string;
  dueAt: string;
  status: string;
  to: string;
  subject: string;
  body: string;
  decidedByName: string;
  decidedAt: string | null;
  errorMessage: string;
}

const DISMISS_KEY = 'paymentFollowUpDismissedOn';

/** "YYYY-MM-DD" du jour, en heure locale (clé d'ouverture quotidienne). */
function todayKey(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDayTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
    + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Nombre de jours entiers écoulés depuis une date (0 = aujourd'hui). */
function daysSince(iso: string): number {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

/** Corps du mail (HTML ou texte) rendu en aperçu. */
function bodyPreviewHtml(body: string): string {
  return /<[a-z][\s\S]*>/i.test(body) ? body : body.replace(/\n/g, '<br>');
}

const card: React.CSSProperties = {
  border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginBottom: 10, background: '#fff',
};
const btnSend: React.CSSProperties = {
  padding: '9px 16px', borderRadius: 9, border: 'none', background: '#4f46e5', color: '#fff',
  fontWeight: 700, fontSize: 13, cursor: 'pointer',
};
const btnSkip: React.CSSProperties = {
  padding: '9px 16px', borderRadius: 9, border: '1px solid #e2e8f0', background: '#fff',
  color: '#64748b', fontWeight: 600, fontSize: 13, cursor: 'pointer',
};
const btnLink: React.CSSProperties = {
  border: 'none', background: 'transparent', color: '#4f46e5', fontSize: 12,
  cursor: 'pointer', padding: 0, fontWeight: 600,
};
const inp: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0',
  background: '#f8fafc', color: '#0f172a', fontSize: 13, outline: 'none',
};

export default function PaymentFollowUpGate() {
  const { user, ready } = useCurrentUser();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [pending, setPending] = useState<FollowUpItem[]>([]);
  const [decided, setDecided] = useState<FollowUpItem[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Personnalisation ponctuelle du message, par relance (id → sujet/corps).
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  // L'ouverture automatique n'a lieu qu'une fois par session de chargement.
  const autoOpened = useRef(false);

  const load = useCallback(async () => {
    if (!user?.name) return;
    try {
      const res = await fetch(`/api/payment-followups?userName=${encodeURIComponent(user.name)}`);
      if (!res.ok) return;
      const data = await res.json();
      setAllowed(Boolean(data.allowed));
      setPending(Array.isArray(data.pending) ? data.pending : []);
      setDecided(Array.isArray(data.decided) ? data.decided : []);
    } catch { /* silencieux : la pop-up ne doit jamais casser le CRM */ }
  }, [user?.name]);

  // Premier relevé dès que l'utilisateur est connu.
  useEffect(() => { if (ready && user) load(); }, [ready, user, load]);

  // Rafraîchissement périodique — uniquement pour les deux relecteurs, et plus
  // souvent quand la pop-up est ouverte : la décision de l'autre doit apparaître
  // pendant qu'on la regarde.
  useEffect(() => {
    if (allowed !== true) return;
    const interval = setInterval(load, open ? 15000 : 120000);
    return () => clearInterval(interval);
  }, [allowed, open, load]);

  // Ouverture automatique à la première visite de la journée.
  useEffect(() => {
    if (allowed !== true || autoOpened.current || pending.length === 0) return;
    autoOpened.current = true;
    let dismissedOn = '';
    try { dismissedOn = localStorage.getItem(DISMISS_KEY) || ''; } catch { /* ignore */ }
    if (dismissedOn !== todayKey()) setOpen(true);
  }, [allowed, pending.length]);

  const closeForToday = () => {
    try { localStorage.setItem(DISMISS_KEY, todayKey()); } catch { /* ignore */ }
    setOpen(false);
  };

  const decide = async (item: FollowUpItem, decision: 'send' | 'skip') => {
    setBusyId(item.id);
    try {
      const edit = edits[item.id];
      const res = await fetch(`/api/payment-followups/${item.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          userId: user?.id || null,
          userName: user?.name || '',
          ...(decision === 'send' && edit ? { subject: edit.subject, body: edit.body } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast(`Relance déjà traitée par ${data?.followUp?.decidedByName || 'l\'autre utilisateur'}`, 'error');
      } else if (!res.ok) {
        toast(data?.error || 'Erreur lors de la relance', 'error');
      } else {
        toast(decision === 'send'
          ? `✓ Relance envoyée à ${item.to}`
          : 'Relance classée sans envoi');
      }
    } catch {
      toast('Erreur réseau lors de la relance', 'error');
    } finally {
      setBusyId(null);
      load();
    }
  };

  if (allowed !== true) return null;

  // Rien à valider et rien de récent à montrer : pas de pastille, pas de pop-up.
  if (!open && pending.length === 0) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Relances « lien de paiement » à valider"
        style={{
          position: 'fixed', right: 18, bottom: 18, zIndex: 150,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '11px 16px', borderRadius: 999, border: 'none', cursor: 'pointer',
          background: '#4f46e5', color: '#fff', fontSize: 13, fontWeight: 700,
          boxShadow: '0 6px 20px rgba(79,70,229,.35)',
        }}
      >
        🔔 {pending.length} relance{pending.length > 1 ? 's' : ''} à valider
      </button>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: 620, maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto', background: '#f8fafc', borderRadius: 16, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
          ☀️ Relances « lien de paiement »
        </div>
        <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, marginBottom: 16 }}>
          {pending.length > 0 ? (
            <>
              <b>{pending.length} affaire{pending.length > 1 ? 's' : ''}</b> {pending.length > 1 ? 'sont' : 'est'} dans
              {' '}<b>LIEN PAIEMENT ENVOYÉ</b> sans avoir bougé depuis le délai de relance.
              Le mail ne part <b>que</b> si tu valides.
            </>
          ) : (
            <>Aucune relance en attente. Voici ce qui a été traité récemment.</>
          )}
        </p>

        {pending.map(item => {
          const edit = edits[item.id];
          const busy = busyId === item.id;
          return (
            <div key={item.id} style={card}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                  {item.brandName ? `${item.brandName} ` : ''}{item.storeName}
                </span>
                {item.city && <span style={{ fontSize: 12, color: '#94a3b8' }}>{item.city}</span>}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                Lien envoyé le <b>{formatDay(item.enteredAt)}</b> · sans mouvement depuis <b>{daysSince(item.enteredAt)} jours</b>
                {item.contactName ? <> · contact : {item.contactName}</> : null}
              </div>
              <div style={{ fontSize: 12, marginTop: 4, color: item.to ? '#334155' : '#b91c1c' }}>
                {item.to
                  ? <>Destinataire : <b>{item.to}</b></>
                  : <>⚠ Aucune adresse email sur cette affaire — impossible de relancer.</>}
              </div>
              {item.status === 'error' && (
                <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 4 }}>
                  ⚠ Envoi échoué{item.decidedByName ? ` (tenté par ${item.decidedByName}${item.decidedAt ? ` le ${formatDayTime(item.decidedAt)}` : ''})` : ''}
                  {item.errorMessage ? ` : ${item.errorMessage}` : ''}
                </div>
              )}

              {/* Message qui partira : visible avant de valider, modifiable au besoin. */}
              <div style={{ marginTop: 10, border: '1px dashed #e2e8f0', borderRadius: 9, padding: 10, background: '#f8fafc' }}>
                {edit ? (
                  <>
                    <input
                      style={{ ...inp, marginBottom: 8, background: '#fff' }}
                      value={edit.subject}
                      onChange={e => setEdits(p => ({ ...p, [item.id]: { ...p[item.id], subject: e.target.value } }))}
                    />
                    <textarea
                      style={{ ...inp, minHeight: 130, background: '#fff', resize: 'vertical', lineHeight: 1.5 }}
                      value={edit.body}
                      onChange={e => setEdits(p => ({ ...p, [item.id]: { ...p[item.id], body: e.target.value } }))}
                    />
                    <button
                      style={{ ...btnLink, marginTop: 6 }}
                      onClick={() => setEdits(p => { const n = { ...p }; delete n[item.id]; return n; })}
                    >
                      ↺ Revenir au message paramétré
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 6 }}>{item.subject}</div>
                    <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.55 }}
                      dangerouslySetInnerHTML={{ __html: bodyPreviewHtml(item.body) }} />
                    <button
                      style={{ ...btnLink, marginTop: 8 }}
                      onClick={() => setEdits(p => ({ ...p, [item.id]: { subject: item.subject, body: item.body } }))}
                    >
                      ✎ Personnaliser ce message
                    </button>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  style={{ ...btnSend, opacity: busy || !item.to ? 0.55 : 1, cursor: busy || !item.to ? 'not-allowed' : 'pointer' }}
                  disabled={busy || !item.to}
                  onClick={() => decide(item, 'send')}
                >
                  {busy ? '⟳ Envoi…' : item.status === 'error' ? '↻ Réessayer l\'envoi' : '✓ Relancer'}
                </button>
                <button
                  style={{ ...btnSkip, opacity: busy ? 0.55 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}
                  disabled={busy}
                  onClick={() => decide(item, 'skip')}
                >
                  ✕ Ne pas relancer
                </button>
              </div>
            </div>
          );
        })}

        {/* Ce que l'autre (ou soi-même) a déjà tranché : chacun voit les
            décisions de l'autre, personne ne relance deux fois. */}
        {decided.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>
              Déjà traité
            </div>
            {decided.map(item => {
              const label =
                item.status === 'sent'    ? { icon: '✓', color: '#059669', text: 'Relancé' }
                : item.status === 'skipped' ? { icon: '✕', color: '#64748b', text: 'Non relancé' }
                : item.status === 'sending' ? { icon: '⟳', color: '#0369a1', text: 'Envoi en cours' }
                : { icon: '⚠', color: '#b91c1c', text: 'Échec de l\'envoi' };
              return (
                <div key={item.id} style={{ ...card, padding: '9px 12px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: label.color, fontWeight: 700, fontSize: 13 }}>{label.icon}</span>
                  <span style={{ flex: 1, fontSize: 12.5, color: '#334155' }}>
                    {item.brandName ? `${item.brandName} ` : ''}{item.storeName}
                  </span>
                  <span style={{ fontSize: 11.5, color: '#94a3b8' }}>
                    {label.text}{item.decidedByName ? ` par ${item.decidedByName}` : ''}
                    {item.decidedAt ? ` · ${formatDayTime(item.decidedAt)}` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button style={{ ...btnSkip, flex: 1 }} onClick={() => setOpen(false)}>
            Fermer
          </button>
          <button style={{ ...btnSkip, flex: 1 }} onClick={closeForToday}>
            Ne plus afficher aujourd&apos;hui
          </button>
        </div>
      </div>
    </div>
  );
}
