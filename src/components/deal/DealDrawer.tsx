'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Action, Note, Priority } from '@/types';
import { formatDate, isOverdue, formatRelativeDate, addMonths, formatCurrency } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/lib/currentUser';
import RichTextEditor from '@/components/ui/RichTextEditor';
import { EMAIL_SENDERS, DEFAULT_EMAIL_SENDER } from '@/lib/emailSenders';
import { PAYMENT_EMAIL_TEMPLATE, paymentRecurrenceLabel } from '@/lib/paymentEmailTemplate';
import MeetInviteModal, { reportMeetSync } from '@/components/pipeline/MeetInviteModal';
import PVModal from '@/components/pipeline/PVModal';
import ClosingDateModal, { type ClosingTarget, type ClosingDateEntry, type ClosingUser } from '@/components/pipeline/ClosingDateModal';
import FlowWarningModal from '@/components/pipeline/FlowWarningModal';
import {
  CLOSING_DEMO_TITLE, CLOSING_PIPELINE_NAME, PROSPECTION_DEMO_TITLE,
  flowForColumn, isSmartlinkColumn, subscriptionLabel, toIsoNoon,
  type FlowKey,
} from '@/lib/pipelineStages';

/** Détecte si une chaîne contient du HTML (balises ou entités, ex. &nbsp;). */
function isHtml(s: string) { return /<[a-z][\s\S]*>|&[a-z#0-9]+;/i.test(s || ''); }


const PRIORITIES: Priority[] = ['faible', 'normale', 'élevée', 'urgente'];
const ACTION_TYPES = ['Appeler', 'Email', 'Relancer', 'Démo', 'Autre'];

/** Délai entre le dévoilement du numéro (= début de l'appel) et la question
 *  « Est-ce que le décisionnaire a pu être contacté ? ». Laisse le temps de
 *  passer l'accueil du magasin avant de demander le résultat. */
const DECISION_MAKER_PROMPT_DELAY_MS = 20_000;

const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a', fontSize: 13, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 12 };
const btnDef: React.CSSProperties = { padding: '6px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 12 };
const labelStyle: React.CSSProperties = { fontSize: 11, color: '#64748b', display: 'block', marginBottom: 3, fontWeight: 500 };
const sectionTitle: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase', margin: '0 0 10px' };

/** Sélecteur segmenté à deux états (ou plus) — utilisé pour le type de paiement
 *  (Virement / Stripe) et la cadence (Comptant / Mensuel) dans l'onglet Abonnement. */
function SegToggle({ value, options, onChange }: {
  value: string;
  options: { value: string; label: string; color: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 9, padding: 3, gap: 3 }}>
      {options.map(o => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              border: 'none', cursor: 'pointer', padding: '6px 16px', borderRadius: 7,
              fontSize: 12.5, fontWeight: 700, transition: 'all .12s',
              background: active ? o.color : 'transparent', color: active ? '#fff' : '#64748b',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

interface Collaborator { id: string; name: string; color: string; email: string; }
interface User { id: string; name: string; color: string; }
interface EmailTemplate { id: string; name: string; subject: string; body: string; }
interface EmailLog { id: string; direction?: 'outbound' | 'inbound'; fromAddress?: string | null; to: string; cc?: string | null; subject: string; body: string; sentAt: string; status: string; scheduledAt?: string | null; openedAt?: string; resendId?: string; template?: { name: string }; }
/** Un changement d'étape journalisé (table DealMove). */
interface DealMove {
  id: string;
  fromColumnTitle: string; fromPipelineName: string;
  toColumnTitle: string;   toPipelineName: string;
  userName: string; source: string; movedAt: string;
}
/** Une démo bookée (table DemoBooking) : une ligne par passage dans « DEMO
 *  PREVUE » (Closing). Un rebooking en ajoute une, sans écraser la précédente. */
interface DemoBooking {
  id: string;
  userName: string;
  bookedAt: string;
  demoDate: string | null;
  noShow: boolean;
  // Qui a fait la démo : personne ne le saisit, c'est l'auteur du déplacement
  // vers « DEMO FAITE », rattaché à ce booking par GET /api/deals/[id].
  doneByName?: string | null;
  doneAt?: string | null;
}
/** Un closing enregistré (table ClosingEvent) : une ligne par abonnement validé
 *  avec une date de closing. Le closeur est celui choisi dans la pop-up, pas
 *  l'auteur du déplacement. */
interface ClosingEvent {
  id: string;
  subscriptionId: string;
  userName: string;
  closingDate: string;
  value: number | null;
  subscriptionType: string;
  recordedAt: string;
}
// Numéro proposé par la recherche automatique quand elle n'a pas pu trancher
// seule (cf. POST /api/deals/[id]/find-phone).
interface PhoneSuggestion { phone: string; name: string; address: string; source: string; url: string; }

/** Un lien de paiement, tel que le renvoie /api/deals/[id]/payment-links. */
interface PaymentLinkOption {
  id: string;
  /** Nom du produit Stripe. */
  name: string;
  /** Montant et périodicité (« 1 200,00 €/mois »). */
  amountLabel: string;
  /** URL finale, client_reference_id compris. */
  url: string;
}

/** Une case du plan tarifaire fixe, avec le lien qui l'occupe (ou aucun). */
interface PaymentLinkSlotOption {
  slotKey: string;
  offerKey: string; offerLabel: string;
  tariffKey: string; tariffLabel: string;
  modeKey: string; modeLabel: string;
  /** « 1 crédit/mois · Tarifs actuels · Paiement mensuel ». */
  fullLabel: string;
  link: PaymentLinkOption | null;
}

interface Props { dealId: string; onClose: () => void; onUpdated: () => void; onNavigate?: (dealId: string) => void; }

function initials(name: string) { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }
function replaceVars(text: string, vars: Record<string, string>) { return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] || ''); }

// Convertit une date ISO en valeur pour un <input type="datetime-local"> (heure locale).
function toLocalInput(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** ISO -> "YYYY-MM-DD" sans décalage de fuseau (on prend la portion date brute). */
function toDateInput(v?: string | null) { return v ? String(v).slice(0, 10) : ''; }
/** "YYYY-MM-DD" -> ISO (midi UTC pour éviter le décalage de jour), ou null. */
function fromDateInput(v: string) { return v ? new Date(v + 'T12:00:00Z').toISOString() : null; }



/** Carte d'édition d'un abonnement (onglet « Abonnement »). Gère son état local
 *  pour une saisie fluide et persiste via onPatch. */
function SubscriptionCard({ sub, index, subscriptionTypes, users, onPatch, onDelete }: {
  sub: any;
  index: number;
  subscriptionTypes: { id: string; name: string }[];
  users: { id: string; name: string }[];
  onPatch: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [value, setValue] = useState(sub.value != null ? String(sub.value) : '');
  const [closing, setClosing] = useState(toDateInput(sub.closingDate));
  const [durYears, setDurYears] = useState(Math.floor((sub.subscriptionMonths ?? 12) / 12));
  const [durMonths, setDurMonths] = useState((sub.subscriptionMonths ?? 12) % 12);
  // Churn : abonnement résilié → sa valeur est exclue du MRR et du Dashboard.
  const churned = !!sub.churned;
  // Pop-up de saisie de la date de résiliation (churn), déclenchée au cochage.
  const [churnModal, setChurnModal] = useState(false);
  const [churnDate, setChurnDate] = useState('');

  // Resynchronise les champs locaux quand on change d'abonnement (id différent).
  useEffect(() => {
    setValue(sub.value != null ? String(sub.value) : '');
    setClosing(toDateInput(sub.closingDate));
    setDurYears(Math.floor((sub.subscriptionMonths ?? 12) / 12));
    setDurMonths((sub.subscriptionMonths ?? 12) % 12);
    setChurnModal(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub.id]);

  // Cochage de la case CHURN : on ouvre la pop-up pour saisir la date de churn.
  // Décochage : on réactive l'abonnement et on efface la date.
  const onToggleChurn = (checked: boolean) => {
    if (checked) {
      setChurnDate(toDateInput(sub.churnedAt) || new Date().toISOString().slice(0, 10));
      setChurnModal(true);
    } else {
      onPatch(sub.id, { churned: false, churnedAt: null });
    }
  };
  const confirmChurn = () => {
    if (!churnDate) return;
    onPatch(sub.id, { churned: true, churnedAt: fromDateInput(churnDate) });
    setChurnModal(false);
  };

  const totalMonths = durYears * 12 + durMonths;
  const endDate = closing ? addMonths(new Date(closing + 'T12:00:00Z'), totalMonths) : null;
  const isStripe = sub.paymentMode !== 'virement';
  const applyDuration = (y: number, mo: number) => {
    const yy = Math.max(0, Math.floor(y || 0));
    const mm = Math.max(0, Math.floor(mo || 0));
    setDurYears(yy); setDurMonths(mm);
    onPatch(sub.id, { subscriptionMonths: yy * 12 + mm });
  };

  return (
    <div style={{
      background: churned ? '#fef2f2' : '#fff',
      border: `1px solid ${churned ? '#fca5a5' : '#e2e8f0'}`,
      borderRadius: 12, padding: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: churned ? '#b91c1c' : '#4338ca', textTransform: 'uppercase', letterSpacing: '.5px' }}>Abonnement {index + 1}</span>
          {churned && (
            <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: '#dc2626', padding: '2px 7px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '.5px' }}>Résilié</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <label
            title="Abonnement résilié (churn) : sa valeur n'est plus comptée dans le MRR ni dans les données du Dashboard"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={churned}
              onChange={e => onToggleChurn(e.target.checked)}
              style={{ width: 15, height: 15, accentColor: '#dc2626', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 12, fontWeight: 800, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '.5px' }}>Churn</span>
          </label>
          <button type="button" onClick={() => onDelete(sub.id)} title="Supprimer cet abonnement"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 12, fontWeight: 600 }}>
            Supprimer
          </button>
        </div>
      </div>

      {churned && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5, color: '#b91c1c', background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 8, padding: '7px 10px', marginBottom: 14 }}>
          <span style={{ flex: 1, minWidth: 200 }}>
            Résilié{sub.churnedAt ? ` le ${formatDate(sub.churnedAt)}` : ''} — sa valeur est exclue du MRR et de toutes les données du Dashboard.
          </span>
          <button
            type="button"
            onClick={() => { setChurnDate(toDateInput(sub.churnedAt) || new Date().toISOString().slice(0, 10)); setChurnModal(true); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: 11.5, fontWeight: 700, textDecoration: 'underline', whiteSpace: 'nowrap' }}>
            Modifier la date
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={labelStyle}>Type d&apos;abonnement</label>
          <select style={inp} value={sub.subscriptionType || ''} onChange={e => onPatch(sub.id, { subscriptionType: e.target.value })}>
            <option value="">— Choisir —</option>
            {subscriptionTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            {sub.subscriptionType && !subscriptionTypes.some(t => t.name === sub.subscriptionType) && (
              <option value={sub.subscriptionType}>{sub.subscriptionType}</option>
            )}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Valeur (€)</label>
          <input
            type="number" style={inp} placeholder="0" value={value}
            onChange={e => setValue(e.target.value)}
            onBlur={() => { const v = value === '' ? null : Number(value); if (v !== (sub.value ?? null)) onPatch(sub.id, { value: v }); }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 14 }}>
        <div>
          <label style={labelStyle}>Type de paiement</label>
          <SegToggle
            value={isStripe ? 'stripe' : 'virement'}
            options={[{ value: 'stripe', label: 'Stripe', color: '#8b5cf6' }, { value: 'virement', label: 'Virement', color: '#64748b' }]}
            onChange={v => onPatch(sub.id, { paymentMode: v })}
          />
        </div>
        <div>
          <label style={labelStyle}>Paiement</label>
          <SegToggle
            value={sub.paymentTiming === 'mensuel' ? 'mensuel' : 'comptant'}
            options={[{ value: 'comptant', label: 'Comptant', color: '#4f46e5' }, { value: 'mensuel', label: 'Mensuel', color: '#0ea5e9' }]}
            onChange={v => onPatch(sub.id, { paymentTiming: v })}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        <div>
          <label style={labelStyle}>Date de closing</label>
          <input
            type="date" style={inp} value={closing}
            onChange={e => setClosing(e.target.value)}
            onBlur={() => { if (closing !== toDateInput(sub.closingDate)) onPatch(sub.id, { closingDate: fromDateInput(closing) }); }}
          />
        </div>
        <div>
          {/* Closeur : renseigné par la pop-up au passage en SMARTLINKÉ,
              corrigeable ici (une affaire closée depuis la fiche, sans pop-up,
              se renseigne aussi d'ici). */}
          <label style={labelStyle}>Closé par</label>
          <select
            style={inp}
            value={sub.closedByUserId || ''}
            onChange={e => onPatch(sub.id, { closedByUserId: e.target.value || null })}
          >
            <option value="">— Non renseigné —</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            {/* Compte supprimé depuis : on garde le nom figé visible. */}
            {sub.closedByName && !users.some(u => u.id === sub.closedByUserId) && (
              <option value={sub.closedByUserId || ''}>{sub.closedByName}</option>
            )}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Durée de l&apos;abonnement</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <input type="number" min={0} style={{ ...inp, width: 60 }} value={durYears} onChange={e => applyDuration(Number(e.target.value), durMonths)} />
            <span style={{ fontSize: 12, color: '#475569' }}>an(s)</span>
            <input type="number" min={0} style={{ ...inp, width: 60 }} value={durMonths} onChange={e => applyDuration(durYears, Number(e.target.value))} />
            <span style={{ fontSize: 12, color: '#475569' }}>mois</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={labelStyle}>Date de fin (calculée automatiquement)</label>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8,
          background: endDate ? '#ecfdf5' : '#f8fafc', border: `1px solid ${endDate ? '#a7f3d0' : '#e2e8f0'}`,
          fontSize: 13.5, fontWeight: 700, color: endDate ? '#047857' : '#94a3b8',
        }}>
          🗓 {endDate ? formatDate(endDate) : '—'}
        </div>
      </div>

      {churnModal && (
        <div
          onClick={() => setChurnModal(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 20, width: 360, maxWidth: '100%', boxShadow: '0 12px 40px rgba(15,23,42,.28)' }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: '#b91c1c', marginBottom: 4 }}>Résiliation de l&apos;abonnement</div>
            <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 16, lineHeight: 1.45 }}>
              Indique la date à laquelle le client a résilié. Elle sert à comptabiliser le churn sur la bonne période dans le Dashboard.
            </div>
            <label style={labelStyle}>Date de churn</label>
            <input type="date" autoFocus value={churnDate} onChange={e => setChurnDate(e.target.value)} style={inp}
              onKeyDown={e => { if (e.key === 'Enter') confirmChurn(); }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button type="button" onClick={() => setChurnModal(false)}
                style={{ height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                Annuler
              </button>
              <button type="button" onClick={confirmChurn} disabled={!churnDate}
                style={{ height: 34, padding: '0 14px', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontSize: 12.5, fontWeight: 700, opacity: churnDate ? 1 : .5, cursor: churnDate ? 'pointer' : 'not-allowed' }}>
                Confirmer la résiliation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DealDrawer({ dealId, onClose, onUpdated, onNavigate }: Props) {
  const { user: currentUser } = useCurrentUser();
  const [deal, setDeal] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  // Onglet actif de la zone de droite : activité (par défaut) ou recrutement.
  const [activeTab, setActiveTab] = useState<'activite' | 'abonnement' | 'recrutement' | 'proches'>('activite');

  // Volet de composition actif : note / action / email / lien de paiement
  const [composer, setComposer] = useState<null | 'note' | 'action' | 'email' | 'payment'>(null);

  // Téléphone du contact : masqué tant que l'utilisateur n'a pas cliqué sur
  // « Afficher le numéro ». Le numéro dévoilé vient de la réponse du serveur,
  // qui comptabilise le clic comme un appel. `phoneRevealing` évite un double
  // comptage sur un double-clic.
  const [revealedPhone, setRevealedPhone] = useState<string | null>(null);
  const [phoneRevealing, setPhoneRevealing] = useState(false);
  // Suivi du résultat de l'appel : on passe toujours par l'accueil du magasin,
  // donc 20 s après le dévoilement du numéro on demande si le décisionnaire a
  // pu être joint (réponse stockée dans CallLog.connected).
  // `pendingCall` = appel dont la question est programmée (timer en cours),
  // `callQuestion` = appel dont la question est actuellement affichée. On garde
  // le magasin et le numéro appelés : le volet peut avoir changé d'affaire
  // entre-temps (navigation « magasins proches »).
  type CallQuestion = { id: string; store: string; phone: string };
  const [pendingCall, setPendingCall] = useState<CallQuestion | null>(null);
  const [callQuestion, setCallQuestion] = useState<CallQuestion | null>(null);
  const [savingCallAnswer, setSavingCallAnswer] = useState(false);
  // Fermeture du volet demandée alors que la question n'a pas encore de réponse :
  // on la pose d'abord, le volet se ferme juste après.
  const [closeAfterAnswer, setCloseAfterAnswer] = useState(false);
  const callTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Recherche automatique du numéro du magasin (OpenStreetMap puis fiche
  // Google). `phoneSuggestions` n'est renseigné que lorsque la recherche
  // trouve des numéros plausibles sans pouvoir trancher : à l'utilisateur de
  // choisir. Null = aucune recherche lancée pour l'instant.
  const [phoneSearching, setPhoneSearching] = useState(false);
  const [phoneSuggestions, setPhoneSuggestions] = useState<PhoneSuggestion[] | null>(null);

  // Données annexes
  const [users, setUsers] = useState<User[]>([]);
  const [brands, setBrands] = useState<{ id: string; name: string; color: string }[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<any[]>([]);
  // Pop-ups posées par la frise avant d'enregistrer l'étape. Chacune retient
  // l'étape visée le temps du choix ; tant qu'elles sont ouvertes, rien n'est
  // persisté. Ce sont exactement celles du drag & drop du pipeline.
  const [meetInvite, setMeetInvite] = useState<{ columnId: string; msg: string } | null>(null);
  // « Démo prévue » (Prospection) : la réponse décide du tag PV/PC et de la
  // duplication vers Recrutement › SOURCING A FAIRE.
  const [pvPrompt, setPvPrompt] = useState(false);
  // « SMARTLINKÉ » : dates de closing des abonnements restant à dater + closeur.
  const [closingPrompt, setClosingPrompt] = useState<{ columnId: string; msg: string; targets: ClosingTarget[] } | null>(null);
  // « DEMO FAITE » / « RELANCE 1 » : détail de la séquence n8n avant qu'elle parte.
  const [flowWarn, setFlowWarn] = useState<{ columnId: string; msg: string; flow: FlowKey } | null>(null);
  const [subscriptionTypes, setSubscriptionTypes] = useState<{ id: string; name: string }[]>([]);
  // Abonnements de l'affaire (1 à 3). Source de vérité de l'onglet « Abonnement ».
  const [subs, setSubs] = useState<any[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  // Offres créées par les organisations rattachées (Supabase), pour la trace
  // « Nouvelle offre créée » de l'onglet Activité.
  const [offerNotifs, setOfferNotifs] = useState<{ id: string; offerTitle: string; offerCreatedAt: string }[]>([]);

  // Champs éditables du sous-volet (saisie locale, sauvegarde au blur)
  const [fields, setFields] = useState<Record<string, string>>({});

  // Formulaire note
  const [noteText, setNote] = useState('');
  // Formulaire action
  const [actionForm, setAF] = useState<Partial<Action> | null>(null);
  // Formulaire email
  const [selectedTemplate, setSelectedTemplate] = useState('');
  // Adresse d'expéditeur choisie (parmi EMAIL_SENDERS, toutes @swipelink.fr).
  const [emailFrom, setEmailFrom] = useState(DEFAULT_EMAIL_SENDER.email);
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [civilite, setCivilite] = useState('Monsieur');
  const [attachments, setAttachments] = useState<{ name: string; content: string }[]>([]);
  // Envoi programmé : '' = tout de suite, sinon une date locale « YYYY-MM-DDTHH:mm ».
  const [emailWhen, setEmailWhen] = useState('');
  // Formulaire « lien de paiement » : liens Stripe actifs résolus pour ce deal,
  // chacun avec son URL finale (client_reference_id = group_id ou organization_id).
  // Le plan tarifaire fixe (42 cases, vides comprises) et les liens spéciaux,
  // tels que les renvoie l'API. Le plan pilote les trois listes déroulantes.
  const [paySlots, setPaySlots] = useState<PaymentLinkSlotOption[]>([]);
  const [paySpecials, setPaySpecials] = useState<PaymentLinkOption[]>([]);
  // Onglet actif : le plan tarifaire, ou les liens créés pour un client.
  const [payTab, setPayTab] = useState<'classique' | 'special'>('classique');
  // Choix en cours dans le plan. Le jeu de tarifs démarre sur « actuel » : les
  // anciens tarifs ne servent qu'aux clients historiques.
  const [payOffer, setPayOffer] = useState('');
  const [payTariff, setPayTariff] = useState('actuel');
  const [payMode, setPayMode] = useState('');
  // Lien spécial retenu, et recherche dans cette liste.
  const [paySpecialId, setPaySpecialId] = useState('');
  const [paySearch, setPaySearch] = useState('');
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState('');
  const [payReference, setPayReference] = useState<{ referenceId: string; kind: 'group' | 'organization'; organizationName: string } | null>(null);
  // Dernier sujet/corps écrits automatiquement par la template « lien de
  // paiement » : tant que l'utilisateur n'y a pas touché, un changement d'offre
  // les régénère ; dès qu'il les modifie, on ne touche plus à rien.
  const [payAutoFill, setPayAutoFill] = useState<{ subject: string; body: string } | null>(null);
  // Variable {{2mag}} : les 2 magasins de la MÊME enseigne les plus proches
  // présents dans le pipeline « Closing » (toutes étapes confondues), sans
  // contrainte de rayon. Calculé à partir de l'endpoint « Magasins proches »
  // (distance Haversine), appelé avec ?all=1 pour lever le plafond de 50 km.
  const [twoMag, setTwoMag] = useState('');
  // Formulaire d'ajout manuel d'offre (null = masqué)
  const [offerForm, setOfferForm] = useState<{ jobTitle: string; contractType: string; salary: string; source: string; url: string } | null>(null);
  const [savingOffer, setSavingOffer] = useState(false);

  // Regroupement : recherche d'un deal parent à rattacher.
  const [showParentSearch, setShowParentSearch] = useState(false);
  const [parentQuery, setParentQuery] = useState('');
  const [parentResults, setParentResults] = useState<any[]>([]);
  const [searchingParent, setSearchingParent] = useState(false);

  const fetchDeal = useCallback(async () => {
    const res = await fetch(`/api/deals/${dealId}`);
    if (res.ok) {
      const d = await res.json();
      setDeal(d);
      setFields({
        storeName: d.store?.name || '',
        directeur: d.directeur || '',
        contactCalling: d.contactCalling || '',
        dealEmail: d.dealEmail || '',
        contactPhone: d.contactPhone || '',
        contactCivilite: d.contactCivilite || 'Monsieur',
        contactLastName: d.contactLastName || '',
        dealValue: d.dealValue != null ? String(d.dealValue) : '',
        demoDate: toLocalInput(d.demoDate),
        candidateCallDate: toDateInput(d.candidateCallDate),
        closingDate: toDateInput(d.closingDate),
      });
      setEmailTo(d.dealEmail || '');
      if (d.contactCivilite) setCivilite(d.contactCivilite);
    }
    setLoading(false);
  }, [dealId]);

  const fetchEmailLogs = useCallback(async () => {
    const res = await fetch(`/api/emails?dealId=${dealId}`);
    if (res.ok) setEmailLogs(await res.json());
  }, [dealId]);

  const fetchOfferNotifs = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications?dealId=${dealId}`);
      if (!res.ok) return;
      const d = await res.json();
      if (d.configured) setOfferNotifs(d.notifications || []);
    } catch { /* silencieux */ }
  }, [dealId]);

  useEffect(() => { fetchDeal(); fetchEmailLogs(); fetchOfferNotifs(); }, [fetchDeal, fetchEmailLogs, fetchOfferNotifs]);

  // Le numéro se remasque dès qu'on change d'affaire : chaque affaire consultée
  // demande donc un nouveau clic (et compte un nouvel appel).
  useEffect(() => { setRevealedPhone(null); setPhoneRevealing(false); }, [dealId]);

  // Géocodage « à la demande » à l'ouverture du deal : si le magasin n'est pas
  // localisé (coordonnées nulles), on déclenche le géocodage côté serveur puis
  // on rafraîchit la fiche (ce qui alimente aussi l'onglet « Magasins proches »
  // et la variable {{2mag}}). Vient en complément du géocodage par lots de la
  // carte. Une seule tentative par magasin et par session (ref) pour ne pas
  // re-solliciter la BAN à chaque re-rendu si l'adresse reste introuvable.
  const geocodeAttempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    const store = deal?.store;
    if (!store) return;
    if (store.latitude != null && store.longitude != null) return;
    if (geocodeAttempted.current.has(store.id)) return;
    geocodeAttempted.current.add(store.id);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/geocode`, { method: 'POST' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.located && !data.alreadyLocated) fetchDeal();
      } catch { /* silencieux : la carte retentera de son côté */ }
    })();
    return () => { cancelled = true; };
  }, [dealId, deal?.store?.id, deal?.store?.latitude, deal?.store?.longitude, fetchDeal]);
  useEffect(() => { fetch('/api/users').then(r => r.json()).then(setUsers).catch(() => {}); }, []);
  useEffect(() => { fetch('/api/brands').then(r => r.json()).then(setBrands).catch(() => {}); }, []);
  useEffect(() => { fetch('/api/columns').then(r => r.json()).then(setColumns).catch(() => {}); }, []);
  useEffect(() => { fetch('/api/pipelines').then(r => r.json()).then(d => setPipelines(d.pipelines || [])).catch(() => {}); }, []);
  useEffect(() => { fetch('/api/email-templates').then(r => r.json()).then(setTemplates).catch(() => {}); }, []);
  useEffect(() => { fetch('/api/subscription-types').then(r => r.json()).then(setSubscriptionTypes).catch(() => {}); }, []);
  const fetchSubs = useCallback(() => {
    fetch(`/api/deals/${dealId}/subscriptions`).then(r => r.json()).then(d => setSubs(Array.isArray(d) ? d : [])).catch(() => {});
  }, [dealId]);
  useEffect(() => { fetchSubs(); }, [fetchSubs]);

  // Calcule la variable {{2mag}} : les 2 magasins de la même enseigne que
  // l'affaire courante, présents dans le pipeline « Closing » (peu importe
  // l'étape) et les plus proches géographiquement, sans limite de distance.
  // Réutilise l'endpoint « Magasins proches » avec ?all=1 (déjà trié par
  // distance croissante) puis filtre sur l'enseigne et le pipeline. Format :
  // « Nom magasin et de Nom magasin » (nom du magasin seul, séparés par « et de »).
  useEffect(() => {
    const myBrand = deal?.store?.brand?.name;
    if (!myBrand) { setTwoMag(''); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/nearby?all=1`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const nearest = (data.deals || [])
          .filter((it: any) =>
            it.pipelineName === 'Closing' &&
            (it.brandName || '').toLowerCase() === myBrand.toLowerCase())
          .slice(0, 2)
          .map((it: any) => it.storeName)
          .join(' et de ');
        if (!cancelled) setTwoMag(nearest);
      } catch {
        if (!cancelled) setTwoMag('');
      }
    })();
    return () => { cancelled = true; };
  }, [dealId, deal?.store?.brand?.name]);

  // Recherche débouncée d'un deal parent à rattacher (réutilise /api/deals/search).
  // On exclut l'affaire courante et les affaires déjà rattachées (sous-deals).
  useEffect(() => {
    if (!showParentSearch) return;
    const term = parentQuery.trim();
    if (term.length < 2) { setParentResults([]); return; }
    setSearchingParent(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/deals/search?q=${encodeURIComponent(term)}`);
        if (res.ok) {
          const list = await res.json();
          setParentResults((Array.isArray(list) ? list : []).filter((r: any) => r.id !== dealId && !r.parentDealId));
        }
      } catch { /* ignore */ } finally { setSearchingParent(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [parentQuery, showParentSearch, dealId]);

  // ---- Mutations -----------------------------------------------------------
  const patchDeal = async (data: Record<string, unknown>, msg?: string) => {
    await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    fetchDeal(); onUpdated(); if (msg) toast(msg);
  };

  // ---- Téléphone (dévoilement = +1 appel pour l'utilisateur) ---------------
  // Le numéro n'est affiché qu'à partir de la réponse du serveur, qui enregistre
  // l'appel au passage. Le garde `phoneRevealing` empêche un double comptage.
  const revealPhone = async () => {
    if (phoneRevealing) return;
    setPhoneRevealing(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/reveal-phone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser?.id || null, userName: currentUser?.name || '' }),
      });
      if (!res.ok) { toast('Impossible d\'afficher le numéro', 'error'); return; }
      const data = await res.json();
      setRevealedPhone(data.phone || '');
      setFields(f => ({ ...f, contactPhone: data.phone || '' }));

      // Appel comptabilisé : on programme la question sur le décisionnaire.
      if (data.callId) {
        const question: CallQuestion = {
          id: data.callId,
          store: deal?.store?.name || '',
          phone: data.phone || '',
        };
        if (callTimerRef.current) clearTimeout(callTimerRef.current);
        setPendingCall(question);
        callTimerRef.current = setTimeout(() => {
          callTimerRef.current = null;
          setPendingCall(null);
          setCallQuestion(question);
        }, DECISION_MAKER_PROMPT_DELAY_MS);
      }
    } catch {
      toast('Impossible d\'afficher le numéro', 'error');
    } finally {
      setPhoneRevealing(false);
    }
  };

  // Le timer ne doit pas survivre au démontage du volet.
  useEffect(() => () => { if (callTimerRef.current) clearTimeout(callTimerRef.current); }, []);

  // Réponse à « Est-ce que le décisionnaire a pu être contacté ? ».
  const answerCallQuestion = async (connected: boolean) => {
    const callId = callQuestion?.id;
    if (!callId || savingCallAnswer) return;
    setSavingCallAnswer(true);
    try {
      const res = await fetch(`/api/calls/${callId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connected }),
      });
      // En cas d'échec on garde la question à l'écran pour permettre un nouvel essai.
      if (!res.ok) { toast('Réponse non enregistrée', 'error'); return; }
      setCallQuestion(null);
      toast(connected ? '✓ Décisionnaire contacté' : 'Décisionnaire non contacté');
      if (closeAfterAnswer) { setCloseAfterAnswer(false); onClose(); }
    } catch {
      toast('Réponse non enregistrée', 'error');
    } finally {
      setSavingCallAnswer(false);
    }
  };

  // Fermeture du volet : si un appel attend encore sa réponse, on pose la
  // question tout de suite plutôt que de perdre l'information.
  const closeDrawer = useCallback(() => {
    if (callTimerRef.current) { clearTimeout(callTimerRef.current); callTimerRef.current = null; }
    if (pendingCall) {
      setCallQuestion(pendingCall);
      setPendingCall(null);
      setCloseAfterAnswer(true);
      return;
    }
    if (callQuestion) { setCloseAfterAnswer(true); return; }
    onClose();
  }, [pendingCall, callQuestion, onClose]);

  // Fermeture au clavier (Échap)
  // Une pop-up de changement d'étape ouverte garde la main : Échap la ferme
  // elle (quand elle l'écoute), sans emporter la fiche avec.
  const stagePromptOpen = !!meetInvite || pvPrompt || !!closingPrompt || !!flowWarn;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !stagePromptOpen) closeDrawer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeDrawer, stagePromptOpen]);

  // ---- Recherche automatique du numéro du magasin --------------------------
  // Reprend la cascade de la campagne de masse (cf. src/lib/phone/lookup.ts)
  // mais sur ce seul magasin : un numéro certain est renseigné directement,
  // sinon les propositions sont affichées pour un choix en un clic.
  const findPhone = async () => {
    if (phoneSearching) return;
    setPhoneSearching(true);
    setPhoneSuggestions(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/find-phone`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Recherche impossible', 'error'); return; }

      if (data.status === 'trouve' && data.phone) {
        setFields(f => ({ ...f, contactPhone: data.phone }));
        setRevealedPhone(data.phone);
        await patchDeal({ contactPhone: data.phone }, `✓ Numéro trouvé : ${data.phone}`);
        return;
      }
      if (data.status === 'a_verifier' && (data.candidates?.length ?? 0) > 0) {
        setPhoneSuggestions(data.candidates);
        toast('Plusieurs numéros possibles : choisissez le bon');
        return;
      }
      setPhoneSuggestions([]);
      // Deux échecs bien distincts, longtemps affichés à l'identique : « la
      // source n'a pas répondu » (à retenter tel quel) et « ce magasin n'y est
      // pas référencé » (inutile d'insister). Les confondre laissait croire à
      // une absence de données là où il n'y avait qu'une attente trop longue.
      if (data.status === 'erreur') {
        toast('OpenStreetMap n\'a pas répondu à temps — réessayez dans un instant', 'error');
      } else {
        toast('Ce magasin n\'est pas référencé dans OpenStreetMap');
      }
    } catch {
      toast('Recherche impossible', 'error');
    } finally {
      setPhoneSearching(false);
    }
  };

  const useSuggestedPhone = async (phone: string) => {
    setPhoneSuggestions(null);
    setFields(f => ({ ...f, contactPhone: phone }));
    setRevealedPhone(phone);
    await patchDeal({ contactPhone: phone }, `✓ ${phone} enregistré`);
  };

  // ---- Démos bookées (case NO SHOW) ----------------------------------------
  // Mise à jour optimiste : la case bascule tout de suite, on repart de l'état
  // précédent si le serveur refuse.
  const toggleNoShow = async (bookingId: string, noShow: boolean) => {
    const apply = (v: boolean) => setDeal((d: any) => d && ({
      ...d,
      demoBookings: (d.demoBookings ?? []).map((b: DemoBooking) => b.id === bookingId ? { ...b, noShow: v } : b),
    }));
    apply(noShow);
    try {
      const res = await fetch(`/api/demo-bookings/${bookingId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        // L'auteur du déplacement automatique vers « ABSENT DEMO », c'est la
        // personne qui coche la case.
        body: JSON.stringify({ noShow, userId: currentUser?.id || null, userName: currentUser?.name || '' }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json().catch(() => ({}));
      if (!noShow) {
        toast('NO SHOW retiré');
      } else if (data.warning) {
        // Colonne « ABSENT DEMO » absente du CRM : on le dit plutôt que de
        // laisser croire à un déplacement.
        toast(data.warning, 'error');
      } else {
        const bits = [
          data.movedTo ? `déplacée dans « ${data.movedTo.title} »` : null,
          data.action ? 'action « REPROGRAMMER DEMO » créée pour aujourd\'hui' : null,
        ].filter(Boolean);
        toast(bits.length ? `NO SHOW · affaire ${bits.join(' · ')}` : 'Démo marquée NO SHOW');
      }
      // Le déplacement et l'action doivent apparaître sans rechargement, dans
      // la fiche comme dans le pipeline.
      if (noShow) { fetchDeal(); onUpdated(); }
    } catch {
      apply(!noShow);
      toast('Impossible de mettre à jour le NO SHOW', 'error');
    }
  };

  // ---- Abonnements ---------------------------------------------------------
  const patchSub = async (id: string, data: Record<string, unknown>) => {
    const res = await fetch(`/api/subscriptions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.ok) { const updated = await res.json(); setSubs(prev => prev.map(s => s.id === id ? updated : s)); onUpdated(); }
  };
  const addSub = async () => {
    const res = await fetch(`/api/deals/${dealId}/subscriptions`, { method: 'POST' });
    if (res.ok) { fetchSubs(); onUpdated(); toast('Abonnement ajouté'); }
    else { const d = await res.json().catch(() => ({})); toast(d.error || 'Erreur', 'error'); }
  };
  const deleteSub = async (id: string) => {
    if (!confirm('Supprimer cet abonnement ?')) return;
    const res = await fetch(`/api/subscriptions/${id}`, { method: 'DELETE' });
    if (res.ok) { fetchSubs(); onUpdated(); toast('Abonnement supprimé'); }
  };

  /**
   * Déplace l'affaire dans une étape depuis la fiche (frise chronologique ou
   * changement de pipeline). `payload` transporte les réponses aux pop-ups
   * (choix PV, invitation Meet, dates de closing) ; `reportMeet` affiche le
   * diagnostic de synchro visio, comme le fait le pipeline.
   */
  const runMove = async (
    columnId: string,
    msg: string,
    opts?: { payload?: Record<string, unknown>; reportMeet?: boolean },
  ) => {
    const prevColumnId = deal?.columnId;
    const prevPipelineId = deal?.pipelineId;
    const targetCol = columns.find(c => c.id === columnId);
    // Mise à jour optimiste : la frise (et le pipeline) reflètent le changement immédiatement.
    setDeal((d: any) => ({ ...d, columnId, pipelineId: targetCol?.pipelineId ?? d.pipelineId, column: targetCol || d.column }));
    try {
      const res = await fetch(`/api/deals/${dealId}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columnId, ...(opts?.payload ?? {}), userId: currentUser?.id || null, userName: currentUser?.name || '', source: 'fiche' }) });
      if (!res.ok) throw new Error();
      const data = await res.json().catch(() => null);
      // Persistance réelle : on recharge depuis le serveur. En mode démo (data.demo),
      // on conserve l'état optimiste (rien n'est persisté côté base).
      if (data && !data.demo) fetchDeal();
      onUpdated();
      toast(msg);
      // Invitation attendue : même diagnostic que depuis le pipeline.
      if (opts?.reportMeet) reportMeetSync(data?.meetSync);
    } catch {
      setDeal((d: any) => ({ ...d, columnId: prevColumnId, pipelineId: prevPipelineId }));
      toast('Erreur lors du changement d\'étape', 'error');
      throw new Error('move');
    }
  };

  /**
   * Changement d'étape depuis la fiche. Les étapes qui déclenchent quelque
   * chose (visio, duplication, dates de closing, séquence de mails) posent
   * d'abord leur pop-up — les mêmes que le drag & drop du pipeline, pour que
   * les deux chemins fassent exactement la même chose. Tant qu'une pop-up
   * attend une réponse, rien n'est enregistré.
   */
  const moveToColumn = async (columnId: string, msg = 'Étape mise à jour') => {
    if (columnId === deal?.columnId) return;
    const targetTitle = columns.find(c => c.id === columnId)?.title;

    // « Démo prévue » (Prospection) : PV ou PC ? La réponse transfère l'affaire
    // dans Closing › DEMO PREVUE et, si OUI, la duplique vers le sourcing.
    if (targetTitle === PROSPECTION_DEMO_TITLE) {
      setPvPrompt(true);
      return;
    }

    // « DEMO PREVUE » (Closing) : envoyer l'invitation Google Meet ou non.
    if (targetTitle === CLOSING_DEMO_TITLE) {
      setMeetInvite({ columnId, msg });
      return;
    }

    // « SMARTLINKÉ » : dates de closing des abonnements restant à dater.
    if (isSmartlinkColumn(targetTitle)) {
      await promptClosingDates(columnId, msg);
      return;
    }

    // « DEMO FAITE » / « RELANCE 1 » : la séquence de mails n8n part avec le
    // déplacement — on la détaille avant, pour pouvoir renoncer.
    const flow = flowForColumn(targetTitle);
    if (flow) {
      setFlowWarn({ columnId, msg, flow });
      return;
    }

    await runMove(columnId, msg).catch(() => {});
  };

  // Réponse à la pop-up « Invitation Google Meet ? » :
  //   - OUI → l'étape est enregistrée ET l'invitation part (sendMeetInvite).
  //   - NON → l'étape est enregistrée, aucune invitation n'est envoyée.
  // Une date corrigée dans la pop-up est enregistrée avec le déplacement.
  const handleMeetConfirm = async (send: boolean, newDemoDate?: string | null) => {
    if (!meetInvite) return;
    await runMove(meetInvite.columnId, send ? meetInvite.msg : `${meetInvite.msg} — aucune invitation envoyée`, {
      payload: {
        sendMeetInvite: send,
        ...(newDemoDate !== undefined ? { demoDate: newDemoDate } : {}),
      },
      reportMeet: send,
    });
    setMeetInvite(null);
  };

  // Réponse à la pop-up « Prospection de Valeur » :
  //   - OUI → l'affaire est transférée dans Closing › DEMO PREVUE ET dupliquée
  //           dans Recrutement › SOURCING A FAIRE (on lance le sourcing).
  //   - NON → l'affaire est simplement transférée dans Closing › DEMO PREVUE.
  // Le transfert (pvChoice) met aussi à jour le tag PV/PC et déclenche la visio
  // et le provisioning Supabase, exactement comme depuis le pipeline.
  const handlePvConfirm = async (choice: 'oui' | 'non') => {
    const closingPipeline = pipelines.find((p: any) => p.name === CLOSING_PIPELINE_NAME);
    const closingCols: any[] = closingPipeline?.columns?.length
      ? closingPipeline.columns
      : columns.filter((c: any) => c.pipelineId === closingPipeline?.id);
    const target = closingCols.find((c: any) => c.title === CLOSING_DEMO_TITLE);
    if (!target) {
      toast('Colonne « DEMO PREVUE » du pipeline Closing introuvable', 'error');
      throw new Error('closing-col');
    }

    await runMove(target.id, 'Affaire transférée dans Closing › DEMO PREVUE', {
      payload: { pvChoice: choice },
      reportMeet: true,
    });

    // OUI uniquement : duplication vers Recrutement › SOURCING A FAIRE.
    if (choice === 'oui') {
      const dupRes = await fetch(`/api/deals/${dealId}/duplicate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice: 'oui' }),
      });
      const data = await dupRes.json().catch(() => ({}));
      if (!dupRes.ok || !data.ok) {
        toast(data.error || 'Erreur lors de la duplication', 'error');
        throw new Error('dup');
      }
      toast('Dupliquée dans Recrutement › SOURCING A FAIRE');
    }

    setPvPrompt(false);
  };

  /**
   * Prépare la pop-up « Date de closing » pour un passage en SMARTLINKÉ.
   *
   * On ne demande une date que pour les abonnements QUI N'EN ONT PAS : une
   * affaire qui décroche un second contrat garde la date de closing du premier.
   * Si tous sont déjà datés, il n'y a rien à saisir — on déplace directement.
   * La liste est relue au moment du passage pour ne pas travailler sur un état
   * périmé ; si la lecture échoue, on retombe sur un champ unique plutôt que de
   * bloquer le changement d'étape.
   */
  const promptClosingDates = async (columnId: string, msg: string) => {
    let list: any[] | null = null;
    try {
      const res = await fetch(`/api/deals/${dealId}/subscriptions`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) list = data;
      }
    } catch { /* lecture impossible : repli sur un champ unique, ci-dessous */ }

    if (list && list.length > 0) {
      const pending = list.filter(sub => !sub.closingDate);

      if (pending.length === 0) {
        await runMove(columnId, `${msg} — tous les abonnements ont déjà une date de closing`).catch(() => {});
        return;
      }

      setClosingPrompt({
        columnId, msg,
        targets: pending.map(sub => ({
          subscriptionId: sub.id,
          // On nomme l'abonnement seulement si l'affaire en compte plusieurs :
          // c'est là que savoir lequel on date compte.
          label: list!.length > 1 ? subscriptionLabel(sub, list!) : '',
        })),
      });
      return;
    }

    // Aucun abonnement (ou lecture impossible) : un seul champ, dont la
    // validation créera l'abonnement côté serveur.
    setClosingPrompt({ columnId, msg, targets: [{ subscriptionId: null, label: '' }] });
  };

  // Réponse à la pop-up « Date de closing ». Les champs laissés vides ne sont
  // pas transmis — l'abonnement reste simplement à dater.
  const handleClosingConfirm = async (entries: ClosingDateEntry[], closedBy: ClosingUser | null) => {
    if (!closingPrompt) return;
    const filled = entries.filter(e => e.date);

    // Une cible sans identifiant = l'affaire n'a aucun abonnement : on envoie la
    // forme simple, que le serveur traduit par une création.
    const isCreation = closingPrompt.targets.length === 1 && closingPrompt.targets[0].subscriptionId === null;
    const payload = isCreation
      ? { closingDate: filled[0] ? toIsoNoon(filled[0].date) : null }
      : { closingDates: filled.map(e => ({ subscriptionId: e.subscriptionId, closingDate: toIsoNoon(e.date) })) };

    const par = closedBy ? ` · closé par ${closedBy.name}` : '';
    await runMove(
      closingPrompt.columnId,
      filled.length === 0 ? `${closingPrompt.msg}${par}`
      : filled.length === 1 ? `Étape mise à jour — date de closing enregistrée${par}`
      : `Étape mise à jour — ${filled.length} dates de closing enregistrées${par}`,
      {
        payload: {
          ...payload,
          // Closeur choisi dans la pop-up : distinct de l'auteur du déplacement.
          closedByUserId: closedBy?.id || null,
          closedByName: closedBy?.name || '',
        },
      },
    );
    fetchSubs();
    setClosingPrompt(null);
  };

  // Séquence automatique confirmée : on enregistre l'étape, ce qui déclenche le
  // webhook n8n côté serveur. Renoncer laisse l'affaire à son étape actuelle,
  // donc aucun mail ne part.
  const handleFlowConfirm = async () => {
    if (!flowWarn) return;
    await runMove(flowWarn.columnId, flowWarn.flow === 'DEMO_FAITE'
      ? 'Affaire déplacée dans DEMO FAITE — séquence promotionnelle lancée'
      : 'Affaire déplacée dans RELANCE 1 — séquence de relance lancée');
    setFlowWarn(null);
  };

  // Change le pipeline du deal : on le place dans la 1re étape du pipeline cible.
  const changePipeline = (pipelineId: string) => {
    if (pipelineId === deal?.pipelineId) return;
    const firstCol = columns
      .filter(c => c.pipelineId === pipelineId)
      .sort((a, b) => a.position - b.position)[0];
    if (!firstCol) { toast('Ce pipeline n\'a aucune étape', 'error'); return; }
    moveToColumn(firstCol.id, 'Pipeline mis à jour');
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dealId, content: noteText, authorId: currentUser?.id || null, authorName: currentUser?.name || '' }) });
    setNote(''); setComposer(null); fetchDeal(); onUpdated(); toast('Note ajoutée');
  };

  const saveAction = async () => {
    if (!actionForm?.title || !actionForm.dueDate) { toast('Titre et date requis', 'error'); return; }
    const url = actionForm.id ? `/api/actions/${actionForm.id}` : '/api/actions';
    await fetch(url, { method: actionForm.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...actionForm, dealId }) });
    setAF(null); setComposer(null); fetchDeal(); onUpdated(); toast('Action enregistrée');
  };

  const doneAction = async (id: string) => {
    await fetch(`/api/actions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) });
    fetchDeal(); onUpdated();
  };
  const reopenAction = async (id: string) => {
    await fetch(`/api/actions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'todo' }) });
    fetchDeal(); onUpdated();
  };
  const deleteAction = async (id: string) => { await fetch(`/api/actions/${id}`, { method: 'DELETE' }); fetchDeal(); onUpdated(); };

  const editNote = async (id: string, content: string) => {
    await fetch(`/api/notes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
    fetchDeal(); onUpdated(); toast('Note modifiée');
  };
  const deleteNote = async (id: string) => {
    if (!window.confirm('Supprimer cette note ?')) return;
    await fetch(`/api/notes/${id}`, { method: 'DELETE' });
    fetchDeal(); onUpdated(); toast('Note supprimée');
  };

  const getVars = (d: any) => ({
    civilite,
    nom_famille: d?.contactLastName || '',
    enseigne: d?.store?.brand?.name || '',
    nom_magasin: d?.store?.name || '',
    ville: d?.store?.city || '',
    directeur: d?.directeur || '',
    contact_calling: d?.contactCalling || '',
    poste: d?.jobOffers?.[0]?.jobTitle || '',
    prenom_expediteur: '',
    '2mag': twoMag,
  });
  const applyTemplate = (templateId: string) => {
    const tpl = templates.find(t => t.id === templateId);
    if (!tpl || !deal) return;
    const vars = getVars(deal);
    setEmailSubject(replaceVars(tpl.subject, vars));
    setEmailBody(replaceVars(tpl.body, vars));
    setSelectedTemplate(templateId);
  };
  const sendEmail = async () => {
    if (!emailTo || !emailSubject || !emailBody) { toast('Destinataire, sujet et corps requis', 'error'); return; }
    setSendingEmail(true);
    try {
      const res = await fetch('/api/emails', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId, templateId: selectedTemplate || null, from: emailFrom, to: emailTo,
          cc: emailCc || null, subject: emailSubject, body: emailBody, attachments,
          // Une valeur de <input type="datetime-local"> est une heure LOCALE :
          // on la convertit en instant absolu pour le serveur.
          scheduledAt: emailWhen ? new Date(emailWhen).toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast(emailWhen ? `🕘 Email programmé pour le ${formatDate(new Date(emailWhen))}` : '✓ Email envoyé !');
      setEmailCc(''); setEmailSubject(''); setEmailBody(''); setSelectedTemplate(''); setAttachments([]); setPayAutoFill(null); setComposer(null); setEmailWhen('');
      fetchEmailLogs();
    } catch (e) {
      toast((e as Error).message || 'Erreur envoi', 'error');
    } finally { setSendingEmail(false); }
  };

  const cancelScheduledEmail = async (id: string) => {
    if (!window.confirm("Annuler cet envoi programmé ? L'email ne partira pas.")) return;
    try {
      const res = await fetch(`/api/emails/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error);
      toast('Envoi annulé');
      fetchEmailLogs();
    } catch (e) {
      toast((e as Error).message || 'Erreur', 'error');
    }
  };

  // ---- Lien de paiement Stripe --------------------------------------------
  // Charge les liens de paiement Stripe actifs, résolus pour ce deal (URL finale
  // avec client_reference_id = group_id ou organization_id). Appelé à l'ouverture
  // du composer « Envoyer un lien de paiement ».
  const loadPaymentLinks = useCallback(async () => {
    setPayLoading(true); setPayError(''); setPayReference(null);
    setPaySlots([]); setPaySpecials([]);
    setPayTab('classique'); setPayOffer(''); setPayTariff('actuel'); setPayMode('');
    setPaySpecialId(''); setPaySearch('');
    try {
      const res = await fetch(`/api/deals/${dealId}/payment-links`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setPayError(data.error || 'Erreur de chargement des liens de paiement.'); return; }
      setPaySlots(Array.isArray(data.slots) ? data.slots : []);
      setPaySpecials(Array.isArray(data.specials) ? data.specials : []);
      setPayReference(data.reference || null);
    } catch {
      setPayError('Erreur réseau lors du chargement des liens Stripe.');
    } finally { setPayLoading(false); }
  }, [dealId]);

  // ---- Parcours du plan tarifaire ------------------------------------------
  // Les trois niveaux sont déduits du plan renvoyé par l'API : une seule source,
  // aucun risque de divergence avec le paramétrage. Un niveau dont AUCUNE case
  // n'est attribuée reste affiché mais désactivé — un trou dans le plan doit se
  // voir, pas disparaître.
  const payOfferOptions = paySlots.reduce<{ key: string; label: string; available: boolean }[]>((acc, slot) => {
    const found = acc.find(o => o.key === slot.offerKey);
    if (found) found.available ||= Boolean(slot.link);
    else acc.push({ key: slot.offerKey, label: slot.offerLabel, available: Boolean(slot.link) });
    return acc;
  }, []);

  const payTariffOptions = paySlots
    .filter(s => s.offerKey === payOffer)
    .reduce<{ key: string; label: string; available: boolean }[]>((acc, slot) => {
      const found = acc.find(t => t.key === slot.tariffKey);
      if (found) found.available ||= Boolean(slot.link);
      else acc.push({ key: slot.tariffKey, label: slot.tariffLabel, available: Boolean(slot.link) });
      return acc;
    }, []);

  const payModeOptions = paySlots
    .filter(s => s.offerKey === payOffer && s.tariffKey === payTariff)
    .map(slot => ({ key: slot.modeKey, label: slot.modeLabel, available: Boolean(slot.link) }));

  const paySelectedSlot = paySlots.find(
    s => s.offerKey === payOffer && s.tariffKey === payTariff && s.modeKey === payMode,
  ) || null;

  /** Change d'offre : les niveaux suivants repartent de zéro. */
  const choosePayOffer = (key: string) => { setPayOffer(key); setPayTariff('actuel'); setPayMode(''); };
  const choosePayTariff = (key: string) => { setPayTariff(key); setPayMode(''); };

  // ---- Liens spéciaux -------------------------------------------------------
  const paySearchTerm = paySearch.trim().toLowerCase();
  const payFilteredSpecials = paySpecials.filter(
    l => !paySearchTerm
      || l.name.toLowerCase().includes(paySearchTerm)
      || l.amountLabel.toLowerCase().includes(paySearchTerm),
  );

  /** Le lien finalement retenu, quel que soit l'onglet, et d'où il vient. */
  const selectedPayLink = payTab === 'classique'
    ? (paySelectedSlot?.link ? { ...paySelectedSlot.link, context: paySelectedSlot.fullLabel } : null)
    : (() => {
        const l = paySpecials.find(x => x.id === paySpecialId);
        return l ? { ...l, context: 'Lien spécial' } : null;
      })();

  // ---- Template automatique de l'email « lien de paiement » -----------------
  // Construit le sujet et le corps de l'email à partir du lien sélectionné :
  // une template CRM dont le nom contient « paiement » (Paramètres → templates)
  // prime sur le modèle intégré. Pour un lien du plan, l'offre/le mode viennent
  // de la case choisie ; pour un lien spécial, du nom du lien Stripe.
  const buildPaymentEmail = () => {
    if (!selectedPayLink || !deal) return null;
    const slot = payTab === 'classique' ? paySelectedSlot : null;
    const offre = slot ? slot.offerLabel : selectedPayLink.name;
    const montant = selectedPayLink.amountLabel || '';
    // Ligne « Paiement » du récapitulatif : la périodicité réelle du lien
    // Stripe prime sur le libellé « Paiement mensuel » du plan — une offre
    // annuelle facturée tous les 2/3/6 mois n'est pas mensuelle. Les modes
    // comptant gardent leur libellé (réduction incluse).
    const recurrence = paymentRecurrenceLabel(montant);
    const mode = slot
      ? (slot.modeKey === 'mensuel' && recurrence ? recurrence : slot.modeLabel)
      : recurrence;
    const recap = ([['Offre', offre], ['Paiement', mode], ['Montant', montant]] as const)
      .filter(([, v]) => v)
      .map(([k, v]) => `<li>${k} : ${v}</li>`)
      .join('');
    const tplCrm = templates.find(t => /paiement/i.test(t.name));
    const base = tplCrm ? { subject: tplCrm.subject, body: tplCrm.body } : PAYMENT_EMAIL_TEMPLATE;
    const vars = {
      ...getVars(deal),
      offre,
      mode_paiement: mode,
      montant,
      recap_offre: recap,
      lien_paiement: selectedPayLink.url,
    };
    const subject = replaceVars(base.subject, vars);
    let body = replaceVars(base.body, vars);
    // Garde-fou : quel que soit le modèle utilisé, l'email doit porter le lien.
    if (!body.includes(selectedPayLink.url)) {
      body += `<p><a href="${selectedPayLink.url}">${selectedPayLink.url}</a></p>`;
    }
    return { subject, body };
  };

  // Remplit l'email dès qu'un lien est choisi, et le régénère à chaque
  // changement d'offre — mais uniquement tant que le sujet/corps sont vides ou
  // encore identiques au dernier remplissage automatique : un texte saisi ou
  // retouché par l'utilisateur n'est jamais écrasé.
  useEffect(() => {
    if (composer !== 'payment' || !selectedPayLink || !deal) return;
    const untouched = (!emailSubject && !emailBody)
      || (payAutoFill !== null && emailSubject === payAutoFill.subject && emailBody === payAutoFill.body);
    if (!untouched) return;
    const generated = buildPaymentEmail();
    if (!generated) return;
    setEmailSubject(generated.subject);
    setEmailBody(generated.body);
    setPayAutoFill(generated);
    // Volontairement limité aux entrées qui changent le contenu généré : le
    // sujet/corps et payAutoFill sont lus mais ne doivent pas re-déclencher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composer, selectedPayLink?.url, payTab, civilite, deal, templates]);

  /** Une ligne cliquable de la liste des liens spéciaux. */
  const renderSpecialRow = (l: PaymentLinkOption) => {
    const selected = l.id === paySpecialId;
    return (
      <button
        key={l.id}
        type="button"
        onClick={() => setPaySpecialId(l.id)}
        title={l.amountLabel ? `${l.name} — ${l.amountLabel}` : l.name}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
          padding: '7px 10px', marginBottom: 4, borderRadius: 7, cursor: 'pointer',
          border: `1px solid ${selected ? '#7c3aed' : '#ede9fe'}`,
          background: selected ? '#f3e8ff' : '#fff',
        }}
      >
        <span style={{ color: selected ? '#7c3aed' : '#cbd5e1', fontSize: 12, flexShrink: 0 }}>{selected ? '●' : '○'}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: selected ? 600 : 500, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {l.name}
        </span>
        {l.amountLabel && (
          <span style={{ fontSize: 11.5, color: selected ? '#7c3aed' : '#64748b', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {l.amountLabel}
          </span>
        )}
      </button>
    );
  };

  const copyPaymentLink = async () => {
    if (!selectedPayLink) return;
    try { await navigator.clipboard.writeText(selectedPayLink.url); toast('✓ Lien de paiement copié !'); }
    catch { toast('Copie impossible (autorisez le presse-papiers)', 'error'); }
  };

  const insertPaymentLink = () => {
    if (!selectedPayLink) return;
    const anchor = `<a href="${selectedPayLink.url}">${selectedPayLink.url}</a>`;
    setEmailBody(prev => (prev ? `${prev}<p>${anchor}</p>` : `<p>${anchor}</p>`));
    toast('Lien inséré dans le message');
  };

  // Ouvre/ferme le composer « lien de paiement » et charge les liens à l'ouverture.
  const togglePaymentComposer = () => {
    const opening = composer !== 'payment';
    setComposer(opening ? 'payment' : null);
    if (opening) loadPaymentLinks();
  };

  // Champs de composition d'un email (template, civilité, destinataire, sujet,
  // corps, pièces jointes, bouton envoyer). Réutilisés par le composer « Email »
  // ET par le composer « Lien de paiement » (qui envoie aussi un email).
  const renderEmailFields = () => (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div>
          <label style={labelStyle}>Template</label>
          <select style={inp} value={selectedTemplate} onChange={e => applyTemplate(e.target.value)}>
            <option value="">— Choisir un template —</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Civilité</label>
          <select style={inp} value={civilite} onChange={e => { setCivilite(e.target.value); if (selectedTemplate) applyTemplate(selectedTemplate); }}>
            <option>Monsieur</option>
            <option>Madame</option>
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Expéditeur</label>
        <select style={inp} value={emailFrom} onChange={e => setEmailFrom(e.target.value)}>
          {EMAIL_SENDERS.map(s => <option key={s.email} value={s.email}>{s.label} — {s.email}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Destinataire *</label>
        <input style={inp} type="email" placeholder="contact@magasin.fr" value={emailTo} onChange={e => setEmailTo(e.target.value)} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Cc (copie)</label>
        <input style={inp} type="text" placeholder="adresse@exemple.fr — plusieurs adresses : séparez par des virgules" value={emailCc} onChange={e => setEmailCc(e.target.value)} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Sujet *</label>
        <input style={inp} placeholder="Objet de l'email" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Message *</label>
        <RichTextEditor value={emailBody} onChange={setEmailBody} placeholder="Corps de l'email…" minHeight={160} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Pièce jointe PDF</label>
        <input type="file" accept=".pdf" multiple onChange={async e => {
          const files = Array.from(e.target.files || []);
          const converted = await Promise.all(files.map(f => new Promise<{ name: string; content: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ name: f.name, content: (reader.result as string).split(',')[1] });
            reader.onerror = reject;
            reader.readAsDataURL(f);
          })));
          setAttachments(converted);
        }} style={{ fontSize: 12, color: '#334155' }} />
        {attachments.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {attachments.map((a, i) => (
              <span key={i} style={{ fontSize: 11, background: '#eef2ff', color: '#4338ca', padding: '2px 8px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                📎 {a.name}
                <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 12, padding: 0 }}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>
      {/* Quand partir : tout de suite, ou à une heure choisie. */}
      <div style={{ marginBottom: 12, padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>Départ</span>
          {([
            ['Tout de suite', ''],
            ['Dans 1 h', dansUneHeure()],
            ['Demain 9 h', demainA(9)],
            ['Lundi 9 h', lundiA(9)],
          ] as const).map(([libelle, valeur]) => (
            <button
              key={libelle}
              onClick={() => setEmailWhen(valeur)}
              style={{
                padding: '4px 10px', fontSize: 12, borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${emailWhen === valeur ? '#6366f1' : '#e2e8f0'}`,
                background: emailWhen === valeur ? '#eef2ff' : '#fff',
                color: emailWhen === valeur ? '#4338ca' : '#475569',
                fontWeight: emailWhen === valeur ? 600 : 400,
              }}
            >
              {libelle}
            </button>
          ))}
          <input
            type="datetime-local"
            value={emailWhen}
            min={dansUneMinute()}
            onChange={e => setEmailWhen(e.target.value)}
            style={{ padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a' }}
          />
        </div>
        {emailWhen && (
          <div style={{ fontSize: 11.5, color: '#4338ca', marginTop: 6 }}>
            Programmé pour le {formatDate(new Date(emailWhen))} — annulable jusque-là depuis la frise.
            {attachments.length > 0 && (
              <span style={{ color: '#b45309' }}> Les pièces jointes ne suivent pas un envoi programmé : retirez-les, ou envoyez tout de suite.</span>
            )}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={sendEmail} disabled={sendingEmail} style={{ ...btnPri, opacity: sendingEmail ? .7 : 1, cursor: sendingEmail ? 'not-allowed' : 'pointer' }}>
          {sendingEmail ? '⟳ Envoi…' : emailWhen ? '🕘 Programmer l\'envoi' : '📧 Envoyer'}
        </button>
        <button style={btnDef} onClick={() => setComposer(null)}>Annuler</button>
      </div>
    </>
  );

  const deleteDeal = async () => {
    const name = deal?.store?.name || 'cette affaire';
    if (!window.confirm(`Supprimer ${name} ? Les actions, notes, offres et emails associés seront définitivement supprimés. Cette action est irréversible.`)) return;
    try {
      const res = await fetch(`/api/deals/${dealId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error);
      toast('Affaire supprimée'); onUpdated(); onClose();
    } catch (e) {
      toast((e as Error).message || 'Erreur lors de la suppression', 'error');
    }
  };

  // Ajout manuel d'une offre rattachée à l'affaire.
  const saveOffer = async () => {
    if (!offerForm?.jobTitle.trim()) { toast('Intitulé du poste requis', 'error'); return; }
    if (!deal?.storeId) { toast('Magasin introuvable', 'error'); return; }
    setSavingOffer(true);
    try {
      const res = await fetch('/api/jobOffers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId, storeId: deal.storeId,
          jobTitle: offerForm.jobTitle.trim(),
          title: offerForm.jobTitle.trim(),
          contractType: offerForm.contractType,
          salary: offerForm.salary,
          source: offerForm.source || 'Manuel',
          url: offerForm.url,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setOfferForm(null); fetchDeal(); onUpdated(); toast('Offre ajoutée');
    } catch (e) {
      toast((e as Error).message || 'Erreur lors de l\'ajout de l\'offre', 'error');
    } finally { setSavingOffer(false); }
  };

  const deleteOffer = async (id: string) => {
    if (!window.confirm('Supprimer cette offre ?')) return;
    const res = await fetch(`/api/jobOffers/${id}`, { method: 'DELETE' });
    if (res.ok) { fetchDeal(); onUpdated(); toast('Offre supprimée'); }
    else toast('Erreur lors de la suppression', 'error');
  };

  // ---- Regroupement d'affaires --------------------------------------------
  // Rattache l'affaire courante à un deal parent (elle devient un sous-deal et
  // disparaît du pipeline). PATCH parentDealId → la validation serveur applique
  // la règle du niveau unique.
  const attachToParent = async (parentId: string) => {
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentDealId: parentId }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setShowParentSearch(false); setParentQuery(''); setParentResults([]);
      fetchDeal(); onUpdated(); toast('Affaire rattachée');
    } catch (e) {
      toast((e as Error).message || 'Erreur lors du rattachement', 'error');
    }
  };

  // Détache l'affaire de son parent : elle réapparaît dans le pipeline.
  const detachFromParent = async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentDealId: null }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      fetchDeal(); onUpdated(); toast('Affaire détachée');
    } catch (e) {
      toast((e as Error).message || 'Erreur lors du détachement', 'error');
    }
  };

  // Détache un sous-deal donné (depuis la fiche du parent).
  const detachChild = async (childId: string) => {
    try {
      const res = await fetch(`/api/deals/${childId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentDealId: null }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      fetchDeal(); onUpdated(); toast('Sous-deal détaché');
    } catch (e) {
      toast((e as Error).message || 'Erreur lors du détachement', 'error');
    }
  };

  // ---- Rendu ---------------------------------------------------------------
  if (loading || !deal) return (
    <div onClick={closeDrawer} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(15,23,42,.4)', display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: '66vw', maxWidth: 1200, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#94a3b8' }}>Chargement…</span>
      </div>
    </div>
  );

  const store = deal.store;
  const brand = store?.brand;
  // Regroupement d'affaires.
  const parentDeal = deal.parentDeal as any | null;
  const childDeals: any[] = deal.childDeals ?? [];
  const ownValue = typeof deal.dealValue === 'number' ? deal.dealValue : 0;
  const groupValue = ownValue + childDeals.reduce((s: number, c: any) => s + (c.dealValue || 0), 0);
  const bc = brand?.color || '#6366f1';
  const isWhite = bc === '#ffffff';
  const movedBack = deal.hasNewOfferFromLastImport && !deal.isNewFromLastImport && deal.previousColumnId;

  // Frise : uniquement les étapes du pipeline auquel appartient le deal.
  const sortedCols = columns
    .filter(c => c.pipelineId === deal.pipelineId)
    .sort((a, b) => a.position - b.position);
  const currentIdx = sortedCols.findIndex(c => c.id === deal.columnId);

  const allActions: any[] = deal.actions ?? [];
  const todoActions = allActions
    .filter(a => a.status === 'todo')
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  // Flux d'activité chronologique (le plus récent en premier) :
  // notes + actions terminées + emails envoyés.
  type Feed =
    | { kind: 'note'; date: number; data: Note }
    | { kind: 'action'; date: number; data: any }
    | { kind: 'email'; date: number; data: EmailLog }
    // Réponse reçue du contact (Resend Inbound) : même donnée, pastille et
    // encadré distincts dans la frise.
    | { kind: 'reply'; date: number; data: EmailLog }
    | { kind: 'offer'; date: number; data: { id: string; offerTitle: string; offerCreatedAt: string } }
    | { kind: 'move'; date: number; data: DealMove }
    | { kind: 'demo'; date: number; data: DemoBooking }
    | { kind: 'closing'; date: number; data: ClosingEvent };
  const feed: Feed[] = [
    ...(deal.notes ?? []).map((n: Note) => ({ kind: 'note' as const, date: new Date(n.createdAt).getTime(), data: n })),
    ...allActions.filter(a => a.status === 'done').map(a => ({ kind: 'action' as const, date: new Date(a.completedAt || a.updatedAt || a.dueDate).getTime(), data: a })),
    ...emailLogs.map(l => ({
      kind: (l.direction === 'inbound' ? 'reply' : 'email') as 'reply' | 'email',
      date: new Date(l.sentAt).getTime(),
      data: l,
    })),
    ...offerNotifs.map(o => ({ kind: 'offer' as const, date: new Date(o.offerCreatedAt).getTime(), data: o })),
    ...((deal.moves ?? []) as DealMove[]).map(m => ({ kind: 'move' as const, date: new Date(m.movedAt).getTime(), data: m })),
    // Démos bookées : une entrée par ligne DemoBooking, donc un rebooking
    // s'ajoute au flux au lieu de remplacer le booking précédent.
    ...((deal.demoBookings ?? []) as DemoBooking[]).map(b => ({ kind: 'demo' as const, date: new Date(b.bookedAt).getTime(), data: b })),
    // Closings enregistrés : une entrée par abonnement validé avec une date de
    // closing. Placée à la date d'ENREGISTREMENT (recordedAt), comme la démo est
    // placée à sa date de booking ; la date de closing elle-même est affichée
    // dans la ligne.
    ...((deal.closingEvents ?? []) as ClosingEvent[]).map(c => ({ kind: 'closing' as const, date: new Date(c.recordedAt).getTime(), data: c })),
  ].sort((a, b) => b.date - a.date);

  const currentAssignedUser = deal.assignedUser as User | null;
  const currentCollab = deal.collaborator as Collaborator | null;

  return (
    <>
    <div onClick={closeDrawer} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(15,23,42,.4)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '66vw', maxWidth: 1200, minWidth: 720, height: '100%', background: '#f8fafc', borderLeft: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* En-tête */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, background: '#fff', borderTop: `4px solid ${bc}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {brand && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: isWhite ? '#2563eb' : bc, marginBottom: 2 }}>{brand.name}</div>}
              <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>{store?.name}</div>
              {store?.city && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>📍 {store.city}{store.department ? `, ${store.department}` : ''}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {deal.isNewFromLastImport && <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 11, padding: '3px 8px', borderRadius: 4, fontWeight: 600 }}>✦ Nouvelle</span>}
              {!deal.isPresentInLastImport && <span style={{ background: '#fee2e2', color: '#b91c1c', fontSize: 11, padding: '3px 8px', borderRadius: 4, fontWeight: 600 }}>⚠ Absente</span>}
              <button
                type="button"
                role="switch"
                aria-checked={!!deal.isPV}
                onClick={() => patchDeal({ isPV: !deal.isPV }, !deal.isPV ? 'Tag PV activé' : 'Tag PC activé')}
                title={deal.isPV ? 'Prospection de Valeur (activé = PV)' : 'Prospection Classique (désactivé = PC)'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none',
                  background: 'none', border: 'none', padding: 0,
                  fontSize: 11, fontWeight: 700, color: deal.isPV ? '#15803d' : '#64748b',
                }}
              >
                {/* Interrupteur à bascule : vert = PV, gris = PC */}
                <span style={{
                  position: 'relative', width: 38, height: 22, borderRadius: 999, flexShrink: 0,
                  background: deal.isPV ? '#22c55e' : '#cbd5e1', transition: 'background .15s',
                }}>
                  <span style={{
                    position: 'absolute', top: 2, left: deal.isPV ? 18 : 2, width: 18, height: 18,
                    borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.25)',
                    transition: 'left .15s',
                  }} />
                </span>
                {deal.isPV ? 'PV' : 'PC'}
              </button>
              <select value={deal.priority} onChange={e => patchDeal({ priority: e.target.value })} style={{ ...inp, width: 'auto', padding: '5px 8px', fontSize: 11, background: '#f8fafc' }}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
              <button onClick={closeDrawer} title="Fermer (Échap)" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 24, color: '#94a3b8', padding: 0, lineHeight: 1 }}>×</button>
            </div>
          </div>

          {/* Sélecteur de pipeline */}
          {pipelines.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase' }}>Pipeline</span>
              <select
                value={deal.pipelineId || ''}
                onChange={e => changePipeline(e.target.value)}
                style={{ ...inp, width: 'auto', padding: '4px 8px', fontSize: 12, fontWeight: 600, background: '#f8fafc', color: '#4338ca' }}
              >
                {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          {/* Frise chronologique du pipeline */}
          {sortedCols.length > 0 && (
            <div style={{ display: 'flex', marginTop: 10, gap: 3, overflowX: 'auto', paddingBottom: 2 }}>
              {sortedCols.map((c, i) => {
                const passed = i < currentIdx;
                const current = i === currentIdx;
                const bg = current ? '#4338ca' : passed ? '#6366f1' : '#e2e8f0';
                const color = current || passed ? '#fff' : '#64748b';
                return (
                  <button
                    key={c.id}
                    onClick={() => moveToColumn(c.id)}
                    title={`Déplacer vers « ${c.title} »`}
                    style={{
                      flex: 1, minWidth: 92, position: 'relative', border: 'none', cursor: 'pointer',
                      background: bg, color, fontSize: 10.5, fontWeight: current ? 700 : 500,
                      padding: '8px 10px 8px 18px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      clipPath: 'polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%, 9px 50%)',
                      transition: 'background .15s',
                    }}
                  >
                    {c.title}
                  </button>
                );
              })}
            </div>
          )}

          {/* Suivi de l'appel : posée 20 s après le dévoilement du numéro (ou tout
              de suite si le volet est fermé avant), la question renseigne
              CallLog.connected.

              Bannière EN LIGNE dans l'en-tête figé du volet, et non plus modale
              plein écran : elle ne masque ni les coordonnées du contact ni le
              fil d'activité, qui reste défilable pendant qu'on y répond. Elle
              garde en revanche son absence d'échappatoire — pas de croix, pas
              de fermeture au clic à côté : la réponse est le seul moyen de
              savoir si l'accueil a passé l'appel au décisionnaire. */}
          {callQuestion && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '9px 12px' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#92400e' }}>
                  📞 Est-ce que le décisionnaire a pu être contacté ?
                </div>
                <div style={{ fontSize: 11.5, color: '#a16207', marginTop: 2 }}>
                  {callQuestion.store}{callQuestion.phone ? ` — ${callQuestion.phone}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  type="button" onClick={() => answerCallQuestion(false)} disabled={savingCallAnswer}
                  style={{ height: 34, padding: '0 18px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 700, cursor: savingCallAnswer ? 'not-allowed' : 'pointer', opacity: savingCallAnswer ? .6 : 1 }}
                >
                  Non
                </button>
                <button
                  type="button" onClick={() => answerCallQuestion(true)} disabled={savingCallAnswer}
                  style={{ height: 34, padding: '0 18px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontSize: 13, fontWeight: 700, cursor: savingCallAnswer ? 'not-allowed' : 'pointer', opacity: savingCallAnswer ? .6 : 1 }}
                >
                  Oui
                </button>
              </div>
            </div>
          )}

          {movedBack && (
            <div style={{ marginTop: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7, padding: '8px 10px', fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 2 }}>⟳ Retournée en &quot;À appeler&quot;</div>
              <div style={{ color: '#78350f' }}>Nouvelle offre détectée lors du dernier import.</div>
            </div>
          )}

          {/* Bannière regroupement : sous-deals rattachés (deal parent) ou
              rattachement à une affaire parente (sous-deal). */}
          {parentDeal && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '8px 11px' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', letterSpacing: '.3px' }}>🏬 Gérée par</span>
              <button
                onClick={() => onNavigate?.(parentDeal.id)}
                title="Ouvrir l'affaire parente"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #ddd6fe', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600, color: '#5b21b6', cursor: onNavigate ? 'pointer' : 'default' }}
              >
                {parentDeal.store?.name || 'Affaire'} →
              </button>
            </div>
          )}
          {childDeals.length > 0 && (
            <div style={{ marginTop: 10, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '9px 11px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', letterSpacing: '.3px' }}>🏬 Magasins du groupe ({childDeals.length})</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#15803d', marginLeft: 'auto' }}>Total {groupValue.toLocaleString('fr-FR')} €</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {childDeals.map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => onNavigate?.(c.id)}
                    title={`Ouvrir ${c.store?.name || 'le sous-deal'}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 500, color: '#334155', cursor: onNavigate ? 'pointer' : 'default' }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: c.store?.brand?.color || '#94a3b8' }} />
                    {c.store?.name || 'Magasin'}
                    {typeof c.dealValue === 'number' && c.dealValue !== 0 && (
                      <span style={{ color: '#15803d', fontWeight: 700 }}>{c.dealValue.toLocaleString('fr-FR')} €</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Corps : sous-volet gauche + activité droite */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* ===== Sous-volet gauche : infos du deal ===== */}
          <div style={{ width: 340, flexShrink: 0, borderRight: '1px solid #e2e8f0', overflowY: 'auto', padding: '18px 18px 28px', background: '#fff' }}>

            <div style={sectionTitle}>Magasin</div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', gap: 8, fontSize: 12.5, marginBottom: 6, alignItems: 'center' }}>
                <span style={{ width: 96, flexShrink: 0, color: '#94a3b8' }}>Enseigne</span>
                <select value={store?.brandId || ''} onChange={e => patchDeal({ brandId: e.target.value || null }, 'Enseigne mise à jour')}
                  style={{ ...inp, flex: 1, padding: '4px 8px', fontSize: 12.5 }}>
                  <option value="">— Aucune —</option>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8, fontSize: 12.5, marginBottom: 6, alignItems: 'center' }}>
                <span style={{ width: 96, flexShrink: 0, color: '#94a3b8' }}>Magasin</span>
                <input
                  style={{ ...inp, flex: 1, padding: '4px 8px', fontSize: 12.5 }}
                  value={fields.storeName ?? ''}
                  placeholder="Nom du magasin"
                  onChange={e => setFields(f => ({ ...f, storeName: e.target.value }))}
                  onBlur={() => {
                    const v = (fields.storeName ?? '').trim();
                    if (v && v !== (store?.name ?? '')) patchDeal({ storeName: v }, 'Nom du magasin mis à jour');
                  }}
                />
              </div>
              {[['Ville', store?.city], ['Département', store?.department]].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', gap: 8, fontSize: 12.5, marginBottom: 6 }}>
                  <span style={{ width: 96, flexShrink: 0, color: '#94a3b8' }}>{l}</span>
                  <span style={{ color: v ? '#334155' : '#cbd5e1' }}>{v || '—'}</span>
                </div>
              ))}
            </div>

            <div style={sectionTitle}>Contact</div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ marginBottom: 9 }}>
                <label style={labelStyle}>Civilité</label>
                <select style={inp} value={fields.contactCivilite} onChange={e => { setFields(f => ({ ...f, contactCivilite: e.target.value })); setCivilite(e.target.value); patchDeal({ contactCivilite: e.target.value }); }}>
                  <option>Monsieur</option>
                  <option>Madame</option>
                </select>
              </div>
              {([['Nom de famille', 'contactLastName', 'Dupont'], ['Directeur', 'directeur', 'Prénom Nom'], ['Contact calling', 'contactCalling', 'Prénom Nom'], ['Email', 'dealEmail', 'contact@magasin.fr']] as const).map(([label, key, ph]) => (
                <div key={key} style={{ marginBottom: 9 }}>
                  <label style={labelStyle}>{label}</label>
                  <input
                    style={inp} placeholder={ph} value={fields[key] ?? ''}
                    onChange={e => setFields(f => ({ ...f, [key]: e.target.value }))}
                    onBlur={() => { if ((fields[key] ?? '') !== (deal[key] ?? '')) patchDeal({ [key]: fields[key] ?? '' }); }}
                  />
                </div>
              ))}

              {/* N° de téléphone : saisi manuellement, puis masqué. Le clic sur
                  « Afficher le numéro » le dévoile ET compte +1 dans le compteur
                  d'appels de l'utilisateur connecté (stats du Dashboard). */}
              <div style={{ marginBottom: 9 }}>
                <label style={labelStyle}>N° de Téléphone</label>
                {(deal.contactPhone || '').trim() && revealedPhone === null ? (
                  // La case elle-même fait office de bouton : un clic dessus
                  // dévoile le numéro (et compte l'appel).
                  <button
                    type="button"
                    onClick={revealPhone}
                    disabled={phoneRevealing}
                    style={{
                      ...inp, textAlign: 'left', color: '#4f46e5', fontWeight: 600,
                      fontFamily: 'inherit', cursor: phoneRevealing ? 'default' : 'pointer',
                      background: phoneRevealing ? '#f8fafc' : '#fff',
                    }}
                  >
                    {phoneRevealing ? 'Affichage…' : 'Afficher le numéro'}
                  </button>
                ) : (
                  <>
                    <input
                      style={inp} placeholder="06 12 34 56 78" value={fields.contactPhone ?? ''}
                      onChange={e => setFields(f => ({ ...f, contactPhone: e.target.value }))}
                      onBlur={() => { if ((fields.contactPhone ?? '') !== (deal.contactPhone ?? '')) patchDeal({ contactPhone: fields.contactPhone ?? '' }); }}
                    />
                    {revealedPhone && revealedPhone.trim() && (
                      <a
                        href={`tel:${revealedPhone.replace(/[^\d+]/g, '')}`}
                        style={{ display: 'inline-block', marginTop: 4, fontSize: 11, color: '#4f46e5', fontWeight: 600, textDecoration: 'none' }}
                      >
                        📞 Appeler {revealedPhone}
                      </a>
                    )}

                    {/* Champ vide : proposition de retrouver le numéro du magasin
                        automatiquement plutôt que d'aller le chercher à la main
                        sur Google. */}
                    {!(fields.contactPhone ?? '').trim() && (
                      <button
                        type="button"
                        onClick={findPhone}
                        disabled={phoneSearching}
                        style={{
                          marginTop: 6, padding: '5px 10px', borderRadius: 6,
                          border: '1px solid #e2e8f0', background: '#f8fafc', color: '#4f46e5',
                          fontSize: 11.5, fontWeight: 600, cursor: phoneSearching ? 'default' : 'pointer',
                        }}
                      >
                        {phoneSearching ? '⟳ Recherche…' : '🔍 Trouver le numéro'}
                      </button>
                    )}

                    {phoneSuggestions !== null && phoneSuggestions.length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {phoneSuggestions.map(s => (
                          <div key={s.phone} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 8px' }}>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>{s.phone}</span>
                            <span style={{ fontSize: 10.5, color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {s.name}{s.address ? ` · ${s.address}` : ''}
                            </span>
                            {s.url && (
                              <a href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 10.5, color: '#4f46e5', textDecoration: 'none', fontWeight: 600 }}>fiche ↗</a>
                            )}
                            <button
                              type="button"
                              onClick={() => useSuggestedPhone(s.phone)}
                              style={{ padding: '2px 8px', borderRadius: 5, border: 'none', background: '#4f46e5', color: '#fff', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}
                            >
                              Utiliser
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div style={sectionTitle}>Affaire</div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ marginBottom: 9 }}>
                <label style={labelStyle}>Date de la démo</label>
                <input
                  type="datetime-local" style={inp} value={fields.demoDate ?? ''}
                  onChange={e => { setFields(f => ({ ...f, demoDate: e.target.value })); patchDeal({ demoDate: e.target.value ? new Date(e.target.value).toISOString() : null }); }}
                />
                {(deal.column?.title === 'Démo prévue' || deal.column?.title === 'DEMO PREVUE') && (
                  <p style={{ fontSize: 11, color: '#64748b', marginTop: 5 }}>
                    Une invitation Google Meet est envoyée au contact{deal.dealEmail ? ` (${deal.dealEmail})` : ''} et à bilal@swipelink.fr à l&apos;enregistrement de la date.
                  </p>
                )}
                {deal.googleMeetUrl && (
                  <a href={deal.googleMeetUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 5, fontSize: 12, color: '#4f46e5', textDecoration: 'underline' }}>
                    🔗 Ouvrir le lien Google Meet
                  </a>
                )}
              </div>
              <div style={{ marginBottom: 9 }}>
                <label style={labelStyle}>Date d&apos;appel des candidats</label>
                <input
                  type="date" style={inp} value={fields.candidateCallDate ?? ''}
                  onChange={e => { setFields(f => ({ ...f, candidateCallDate: e.target.value })); patchDeal({ candidateCallDate: fromDateInput(e.target.value) }); }}
                />
              </div>
              <div>
                <label style={labelStyle}>Assigné à</label>
                <select
                  style={inp}
                  value={currentAssignedUser?.id || (currentCollab ? `collab:${currentCollab.id}` : '')}
                  onChange={e => {
                    const v = e.target.value;
                    // Valeur historique (collaborateur déjà assigné) : aucune action.
                    if (v.startsWith('collab:')) return;
                    // Toute (ré)assignation passe désormais par la liste des utilisateurs ;
                    // on retire au passage l'éventuel collaborateur hérité.
                    patchDeal({ assignedUserId: v || null, collaboratorId: null }, 'Assignation mise à jour');
                  }}
                >
                  <option value="">— Personne —</option>
                  {!currentAssignedUser && currentCollab && (
                    <option value={`collab:${currentCollab.id}`}>{currentCollab.name}</option>
                  )}
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>

            <div style={sectionTitle}>Regroupement</div>
            <div style={{ marginBottom: 18 }}>
              {parentDeal ? (
                /* L'affaire est un sous-deal : gérée par une autre affaire. */
                <div style={{ border: '1px solid #ddd6fe', background: '#f5f3ff', borderRadius: 8, padding: '10px 11px' }}>
                  <div style={{ fontSize: 11, color: '#7c3aed', fontWeight: 700, marginBottom: 4 }}>Gérée par</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {parentDeal.store?.name || 'Affaire'}
                      </div>
                      {parentDeal.store?.brand?.name && <div style={{ fontSize: 11, color: '#94a3b8' }}>{parentDeal.store.brand.name}</div>}
                    </div>
                    {onNavigate && (
                      <button onClick={() => onNavigate(parentDeal.id)} style={{ ...btnDef, padding: '4px 9px', fontSize: 11 }}>Ouvrir →</button>
                    )}
                  </div>
                  <button onClick={detachFromParent} style={{ marginTop: 8, background: 'none', border: 'none', color: '#dc2626', fontSize: 11.5, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                    Détacher de cette affaire
                  </button>
                </div>
              ) : (
                /* L'affaire est autonome ou parente. */
                <>
                  {childDeals.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>Magasins du groupe ({childDeals.length})</span>
                        <span style={{ fontSize: 11.5, color: '#15803d', fontWeight: 700 }}>Total {groupValue.toLocaleString('fr-FR')} €</span>
                      </div>
                      {childDeals.map((c: any) => (
                        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: c.store?.brand?.color || '#94a3b8' }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.store?.name || 'Magasin'}</div>
                            <div style={{ fontSize: 10.5, color: '#94a3b8' }}>
                              {[c.store?.city, c.column?.title, typeof c.dealValue === 'number' && c.dealValue !== 0 ? `${c.dealValue.toLocaleString('fr-FR')} €` : null].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          {onNavigate && <button onClick={() => onNavigate(c.id)} title="Ouvrir le sous-deal" style={{ ...btnDef, padding: '3px 8px', fontSize: 11 }}>→</button>}
                          <button onClick={() => detachChild(c.id)} title="Détacher" style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: 13, cursor: 'pointer', padding: 0, flexShrink: 0 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {showParentSearch ? (
                    <div style={{ border: '1px solid #c7d2fe', borderRadius: 8, padding: 11, background: '#f8fafc' }}>
                      <label style={labelStyle}>Rechercher l&apos;affaire qui gérera celle-ci</label>
                      <input style={inp} autoFocus placeholder="Nom du magasin, ville, enseigne…" value={parentQuery} onChange={e => setParentQuery(e.target.value)} />
                      <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto' }}>
                        {searchingParent && parentResults.length === 0 && <p style={{ fontSize: 12, color: '#94a3b8' }}>Recherche…</p>}
                        {!searchingParent && parentQuery.trim().length >= 2 && parentResults.length === 0 && <p style={{ fontSize: 12, color: '#94a3b8' }}>Aucune affaire éligible.</p>}
                        {parentResults.map((r: any) => (
                          <button key={r.id} onClick={() => attachToParent(r.id)}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', padding: '7px 4px', borderBottom: '1px solid #f1f5f9' }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: r.store?.brand?.color || '#94a3b8' }} />
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.store?.name || 'Affaire'}</span>
                              <span style={{ display: 'block', fontSize: 11, color: '#94a3b8' }}>{[r.store?.brand?.name, r.store?.city, r.column?.title].filter(Boolean).join(' · ')}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                      <button style={{ ...btnDef, marginTop: 8 }} onClick={() => { setShowParentSearch(false); setParentQuery(''); setParentResults([]); }}>Annuler</button>
                    </div>
                  ) : (
                    <button onClick={() => setShowParentSearch(true)} style={{ ...btnDef, width: '100%', background: '#fff', padding: '8px 12px' }}>
                      🏬 Rattacher à une autre affaire
                    </button>
                  )}
                  <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
                    Rattacher cette affaire la fait disparaître du pipeline ; elle reste accessible via son affaire parente et la recherche.
                  </p>
                </>
              )}
            </div>

            <div style={sectionTitle}>Offres</div>
            <div style={{ marginBottom: 18 }}>
              {(deal.jobOffers ?? []).length === 0 && <p style={{ color: '#cbd5e1', fontSize: 12.5 }}>Aucune offre.</p>}
              {(deal.jobOffers ?? []).map((o: any, i: number) => (
                <div key={o.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 11px', marginBottom: 7, background: i === 0 ? '#f5f3ff' : '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a', flex: 1, minWidth: 0 }}>{o.jobTitle || o.title || 'Offre'}</span>
                    {i === 0 && <span style={{ fontSize: 9.5, fontWeight: 700, background: '#ede9fe', color: '#6d28d9', padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>DERNIÈRE</span>}
                    <button onClick={() => deleteOffer(o.id)} title="Supprimer l'offre" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: 12, padding: 0, flexShrink: 0 }}>🗑</button>
                  </div>
                  {(o.contractType || o.salary) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, color: '#64748b', marginBottom: 4 }}>
                      {o.contractType && <span style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 3 }}>{o.contractType}</span>}
                      {o.salary && <span style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 3 }}>{o.salary}</span>}
                    </div>
                  )}
                  {(o.publishedAt || o.source) && (
                    <div style={{ fontSize: 10.5, color: '#94a3b8' }}>
                      {o.publishedAt && <span>Publiée le {o.publishedAt}</span>}
                      {o.source && <span>{o.publishedAt ? ' · ' : ''}{o.source}</span>}
                    </div>
                  )}
                  {o.url && <a href={o.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#4f46e5', textDecoration: 'underline', display: 'inline-block', marginTop: 4 }}>🔗 Voir l&apos;offre</a>}
                </div>
              ))}

              {offerForm ? (
                <div style={{ border: '1px solid #c7d2fe', borderRadius: 8, padding: 11, background: '#f8fafc' }}>
                  <div style={{ marginBottom: 8 }}>
                    <label style={labelStyle}>Intitulé du poste *</label>
                    <input style={inp} placeholder="Ex. Boucher" value={offerForm.jobTitle} autoFocus
                      onChange={e => setOfferForm(f => f && ({ ...f, jobTitle: e.target.value }))} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div>
                      <label style={labelStyle}>Type de contrat</label>
                      <input style={inp} placeholder="CDI…" value={offerForm.contractType}
                        onChange={e => setOfferForm(f => f && ({ ...f, contractType: e.target.value }))} />
                    </div>
                    <div>
                      <label style={labelStyle}>Salaire</label>
                      <input style={inp} placeholder="—" value={offerForm.salary}
                        onChange={e => setOfferForm(f => f && ({ ...f, salary: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={labelStyle}>Source</label>
                    <input style={inp} placeholder="Manuel" value={offerForm.source}
                      onChange={e => setOfferForm(f => f && ({ ...f, source: e.target.value }))} />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={labelStyle}>Lien de l&apos;offre</label>
                    <input style={inp} placeholder="https://…" value={offerForm.url}
                      onChange={e => setOfferForm(f => f && ({ ...f, url: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={{ ...btnPri, opacity: savingOffer ? .7 : 1, cursor: savingOffer ? 'not-allowed' : 'pointer' }} onClick={saveOffer} disabled={savingOffer}>{savingOffer ? '⟳ Ajout…' : 'Ajouter'}</button>
                    <button style={btnDef} onClick={() => setOfferForm(null)}>Annuler</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setOfferForm({ jobTitle: '', contractType: '', salary: '', source: '', url: '' })}
                  style={{ ...btnDef, width: '100%', background: '#fff', padding: '8px 12px' }}>+ Ajouter une offre</button>
              )}
            </div>

            <div style={sectionTitle}>CRM</div>
            <div style={{ marginBottom: 22 }}>
              {[['Créé le', formatDate(deal.createdAt)], ['Dernier import', formatDate(deal.lastImportAt)]].map(([l, v]) => v && v !== '—' && (
                <div key={l} style={{ display: 'flex', gap: 8, fontSize: 12.5, marginBottom: 6 }}>
                  <span style={{ width: 96, flexShrink: 0, color: '#94a3b8' }}>{l}</span>
                  <span style={{ color: '#334155' }}>{v}</span>
                </div>
              ))}
            </div>

            <button onClick={deleteDeal} style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
              🗑 Supprimer l&apos;affaire
            </button>
          </div>

          {/* ===== Zone d'activité droite ===== */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px' }}>

            {/* Onglets : Activité / Recrutement */}
            <div style={{ display: 'flex', gap: 22, borderBottom: '1px solid #e2e8f0', marginBottom: 20 }}>
              {([['activite', 'Activité'], ['abonnement', 'Abonnement'], ['recrutement', 'Recrutement'], ['proches', 'Magasins proches']] as const).map(([key, label]) => {
                const active = activeTab === key;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 10px',
                      fontSize: 13.5, fontWeight: active ? 700 : 500,
                      color: active ? '#4338ca' : '#64748b',
                      borderBottom: active ? '2px solid #4338ca' : '2px solid transparent',
                      marginBottom: -1,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {activeTab === 'activite' && (
            <>
            {/* Trois boutons d'action */}
            <div style={{ display: 'flex', gap: 10, marginBottom: composer ? 14 : 22 }}>
              <button onClick={() => setComposer(composer === 'note' ? null : 'note')} style={composer === 'note' ? { ...btnPri, padding: '10px 16px', fontSize: 13 } : { ...btnDef, padding: '10px 16px', fontSize: 13, background: '#fff' }}>📝 Ajouter une note</button>
              <button onClick={() => { setComposer(composer === 'action' ? null : 'action'); if (composer !== 'action') setAF({ title: '', type: 'Appeler', dueDate: new Date().toISOString().slice(0, 10), priority: 'normale', note: '', dueTime: '', assignedUserId: currentUser?.id || '' } as any); }} style={composer === 'action' ? { ...btnPri, padding: '10px 16px', fontSize: 13 } : { ...btnDef, padding: '10px 16px', fontSize: 13, background: '#fff' }}>✅ Ajouter une action</button>
              <button onClick={() => setComposer(composer === 'email' ? null : 'email')} style={composer === 'email' ? { ...btnPri, padding: '10px 16px', fontSize: 13 } : { ...btnDef, padding: '10px 16px', fontSize: 13, background: '#fff' }}>📧 Envoyer un mail</button>
              <button onClick={togglePaymentComposer} style={composer === 'payment'
                ? { padding: '10px 16px', fontSize: 13, borderRadius: 7, border: 'none', background: '#7c3aed', color: '#fff', fontWeight: 600, cursor: 'pointer' }
                : { padding: '10px 16px', fontSize: 13, borderRadius: 7, border: '1px solid #ddd6fe', background: '#faf5ff', color: '#7c3aed', fontWeight: 600, cursor: 'pointer' }}>💳 Envoyer un lien de paiement</button>
            </div>

            {/* Composer : Note */}
            {composer === 'note' && (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 22 }}>
                <textarea style={{ ...inp, height: 80, resize: 'vertical', marginBottom: 10 }} placeholder="Saisir une note…" value={noteText} onChange={e => setNote(e.target.value)} autoFocus />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btnPri} onClick={addNote}>Ajouter la note</button>
                  <button style={btnDef} onClick={() => { setComposer(null); setNote(''); }}>Annuler</button>
                </div>
              </div>
            )}

            {/* Composer : Action */}
            {composer === 'action' && actionForm && (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 22 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <input style={{ ...inp, gridColumn: '1/-1' }} placeholder="Titre *" value={actionForm.title || ''} onChange={e => setAF(f => ({ ...f, title: e.target.value }))} autoFocus />
                  <select style={inp} value={actionForm.type || 'Appeler'} onChange={e => setAF(f => ({ ...f, type: e.target.value as Action['type'] }))}>{ACTION_TYPES.map(t => <option key={t}>{t}</option>)}</select>
                  <select style={inp} value={actionForm.priority || 'normale'} onChange={e => setAF(f => ({ ...f, priority: e.target.value as Priority }))}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select>
                  <input type="date" style={inp} value={typeof actionForm.dueDate === 'string' ? actionForm.dueDate.slice(0, 10) : ''} onChange={e => setAF(f => ({ ...f, dueDate: e.target.value }))} />
                  <input type="time" style={inp} value={(actionForm as any).dueTime || ''} onChange={e => setAF(f => ({ ...f, dueTime: e.target.value } as any))} />
                  <select style={{ ...inp, gridColumn: '1/-1' }} value={(actionForm as any).assignedUserId || ''} onChange={e => setAF(f => ({ ...f, assignedUserId: e.target.value } as any))}>
                    <option value="">— Assignée à (utilisateur) —</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <textarea style={{ ...inp, height: 50, resize: 'none', gridColumn: '1/-1' }} placeholder="Note…" value={actionForm.note || ''} onChange={e => setAF(f => ({ ...f, note: e.target.value }))} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btnPri} onClick={saveAction}>Enregistrer</button>
                  <button style={btnDef} onClick={() => { setComposer(null); setAF(null); }}>Annuler</button>
                </div>
              </div>
            )}

            {/* Composer : Email */}
            {composer === 'email' && (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 22 }}>
                {renderEmailFields()}
              </div>
            )}

            {/* Composer : Lien de paiement (Stripe) — envoie aussi un email */}
            {composer === 'payment' && (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 22 }}>
                {/* Sélection du lien de paiement Stripe + URL finale à copier */}
                <div style={{ background: '#faf5ff', border: '1px solid #ede9fe', borderRadius: 10, padding: 12, marginBottom: 14 }}>
                  <label style={labelStyle}>💳 Lien de paiement Stripe</label>
                  {payLoading ? (
                    <div style={{ fontSize: 12.5, color: '#7c3aed' }}>⟳ Chargement des liens de paiement…</div>
                  ) : payError ? (
                    <div style={{ fontSize: 12.5, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>{payError}</span>
                      <button onClick={loadPaymentLinks} style={{ ...btnDef, padding: '2px 8px', fontSize: 11 }}>Réessayer</button>
                    </div>
                  ) : paySlots.length === 0 ? (
                    // Le plan tarifaire est codé en dur : l'API en renvoie
                    // toujours les 42 cases. Une liste vide signifie donc que
                    // cette page tourne encore sur un JavaScript antérieur à une
                    // mise à jour du CRM (onglet resté ouvert pendant un
                    // déploiement) — pas que Stripe n'a plus de liens.
                    <div style={{ fontSize: 12.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>Cette page a été chargée avant une mise à jour du CRM. Rechargez-la pour retrouver les liens de paiement.</span>
                      <button onClick={() => window.location.reload()} style={{ ...btnDef, padding: '2px 8px', fontSize: 11 }}>Recharger</button>
                    </div>
                  ) : paySpecials.length === 0 && paySlots.every(s => !s.link) ? (
                    <div style={{ fontSize: 12.5, color: '#94a3b8' }}>Aucun lien de paiement actif sur Stripe.</div>
                  ) : (
                    <>
                      {/* Deux familles, deux onglets : le plan tarifaire d'un
                          côté, les liens dédiés à un client de l'autre. */}
                      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                        {([['classique', 'Plan tarifaire'], ['special', `Liens spéciaux (${paySpecials.length})`]] as const).map(([key, label]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setPayTab(key)}
                            style={{
                              padding: '5px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                              border: `1px solid ${payTab === key ? '#7c3aed' : '#ede9fe'}`,
                              background: payTab === key ? '#7c3aed' : '#fff',
                              color: payTab === key ? '#fff' : '#7c3aed',
                            }}
                          >{label}</button>
                        ))}
                      </div>

                      {payTab === 'classique' ? (
                        <>
                          <div style={{ display: 'grid', gap: 8 }}>
                            <div>
                              <label style={labelStyle}>Offre</label>
                              <select style={inp} value={payOffer} onChange={e => choosePayOffer(e.target.value)}>
                                <option value="">— Choisir une offre —</option>
                                {payOfferOptions.map(o => (
                                  <option key={o.key} value={o.key} disabled={!o.available}>
                                    {o.label}{o.available ? '' : ' — non configurée'}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label style={labelStyle}>Tarifs</label>
                              <select style={inp} value={payTariff} onChange={e => choosePayTariff(e.target.value)} disabled={!payOffer}>
                                {payTariffOptions.length === 0 && <option value="actuel">Tarifs actuels</option>}
                                {payTariffOptions.map(t => (
                                  <option key={t.key} value={t.key} disabled={!t.available}>
                                    {t.label}{t.available ? '' : ' — non configurés'}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label style={labelStyle}>Mode de paiement</label>
                              <select style={inp} value={payMode} onChange={e => setPayMode(e.target.value)} disabled={!payOffer}>
                                <option value="">— Choisir un mode de paiement —</option>
                                {payModeOptions.map(m => (
                                  <option key={m.key} value={m.key} disabled={!m.available}>
                                    {m.label}{m.available ? '' : ' — non configuré'}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          {payOffer && payMode && !paySelectedSlot?.link && (
                            <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '7px 10px', marginTop: 8 }}>
                              Aucun lien Stripe n&apos;est attribué à cette combinaison. Renseignez-la dans Paramètres › Liens de paiement.
                            </div>
                          )}
                        </>
                      ) : paySpecials.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: '#94a3b8' }}>
                          Aucun lien spécial : tous les liens Stripe actifs occupent une case du plan tarifaire.
                        </div>
                      ) : (
                        <>
                          <input
                            style={{ ...inp, marginBottom: 8 }}
                            placeholder="Rechercher un lien spécial…"
                            value={paySearch}
                            onChange={e => setPaySearch(e.target.value)}
                          />
                          <div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 2 }}>
                            {payFilteredSpecials.length === 0
                              ? <div style={{ fontSize: 12, color: '#94a3b8' }}>Aucun lien ne correspond à la recherche.</div>
                              : payFilteredSpecials.map(renderSpecialRow)}
                          </div>
                        </>
                      )}
                      {payReference && (
                        <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 6 }}>
                          Rattaché à <b>{payReference.organizationName}</b> · <code style={{ fontFamily: 'monospace' }}>{payReference.kind === 'group' ? 'group_id' : 'organization_id'}={payReference.referenceId}</code>
                        </div>
                      )}
                      {selectedPayLink && (
                        <div style={{ marginTop: 10 }}>
                          {/* Rappel explicite du lien retenu : on nomme la case du
                              plan (ou « lien spécial ») ET le produit Stripe, pour
                              qu'une erreur d'attribution se voie avant l'envoi. */}
                          <label style={labelStyle}>
                            Lien à envoyer — <b style={{ color: '#7c3aed' }}>{selectedPayLink.context}</b>
                            {' · '}{selectedPayLink.name}{selectedPayLink.amountLabel ? ` — ${selectedPayLink.amountLabel}` : ''}
                            <span style={{ color: '#94a3b8' }}> (client_reference_id ajouté)</span>
                          </label>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input readOnly value={selectedPayLink.url} onFocus={e => e.currentTarget.select()} style={{ ...inp, flex: 1, fontFamily: 'monospace', fontSize: 11 }} />
                            <button onClick={copyPaymentLink} style={{ ...btnPri, background: '#7c3aed', whiteSpace: 'nowrap' }}>Copier</button>
                            <button onClick={insertPaymentLink} style={{ ...btnDef, whiteSpace: 'nowrap' }} title="Insérer le lien dans le message">Insérer</button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
                {/* Champs email (le lien se colle / s'insère dans le message) */}
                {renderEmailFields()}
              </div>
            )}

            {/* Actions programmées (à venir, aujourd'hui, en retard) */}
            <div style={{ marginBottom: 26 }}>
              <div style={{ ...sectionTitle, marginBottom: 12 }}>Actions programmées {todoActions.length > 0 && `(${todoActions.length})`}</div>
              {todoActions.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>Aucune action programmée.</p>}
              {todoActions.map(a => {
                const late = isOverdue(a.dueDate) && new Date(a.dueDate).toDateString() !== new Date().toDateString();
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 13px', borderRadius: 9, border: `1px solid ${late ? '#fecaca' : '#e2e8f0'}`, background: late ? '#fef2f2' : '#fff', marginBottom: 7 }}>
                    <button onClick={() => doneAction(a.id)} title="Marquer comme terminée" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #cbd5e1', background: 'transparent', cursor: 'pointer', flexShrink: 0, marginTop: 1 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{a.title}</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 3, fontSize: 11.5, color: late ? '#dc2626' : '#64748b', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ background: '#eef2ff', color: '#4338ca', padding: '1px 6px', borderRadius: 3 }}>{a.type}</span>
                        <span style={{ fontWeight: late ? 700 : 400 }}>{formatRelativeDate(a.dueDate)} · {formatDate(a.dueDate)}</span>
                        {a.dueTime && <span>à {a.dueTime}</span>}
                        {a.assignedUser && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 16, height: 16, borderRadius: '50%', background: a.assignedUser.color, color: '#fff', fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{initials(a.assignedUser.name)}</span>
                            {a.assignedUser.name}
                          </span>
                        )}
                      </div>
                      {a.note && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{a.note}</div>}
                    </div>
                    <button onClick={() => { setComposer('action'); setAF({ ...a, dueDate: typeof a.dueDate === 'string' ? a.dueDate.slice(0, 10) : '' }); }} style={{ ...btnDef, padding: '3px 7px', fontSize: 11 }}>✎</button>
                    <button onClick={() => deleteAction(a.id)} style={{ ...btnDef, padding: '3px 7px', fontSize: 11 }}>🗑</button>
                  </div>
                );
              })}
            </div>

            {/* Historique chronologique : notes, actions terminées, emails */}
            <div>
              <div style={{ ...sectionTitle, marginBottom: 12 }}>Historique</div>
              {feed.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>Aucune activité pour le moment.</p>}
              <div style={{ position: 'relative' }}>
                {feed.map((item, idx) => (
                  <div key={`${item.kind}-${idx}`} style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                    {/* Pastille + fil */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 28 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, opacity: item.kind === 'offer' || item.kind === 'move' ? 0.7 : 1, background: item.kind === 'note' ? '#fef9c3' : item.kind === 'action' ? '#dcfce7' : item.kind === 'offer' ? '#f1f5f9' : item.kind === 'move' ? '#ede9fe' : item.kind === 'demo' ? '#fde68a' : item.kind === 'closing' ? '#bbf7d0' : item.kind === 'reply' ? '#e0e7ff' : '#dbeafe' }}>
                        {item.kind === 'note' ? '📝' : item.kind === 'action' ? '✅' : item.kind === 'offer' ? '💼' : item.kind === 'move' ? '↔' : item.kind === 'demo' ? '🎉' : item.kind === 'closing' ? '🤝' : item.kind === 'reply' ? '💬' : '📧'}
                      </div>
                      {idx < feed.length - 1 && <div style={{ flex: 1, width: 2, background: '#e2e8f0', marginTop: 4 }} />}
                    </div>

                    <div style={item.kind === 'offer' || item.kind === 'move'
                      ? { flex: 1, minWidth: 0, padding: '4px 2px', alignSelf: 'center' }
                      : item.kind === 'demo'
                      // Ligne festive : encadré ambré, volontairement plus visible
                      // que les autres entrées du flux.
                      ? { flex: 1, minWidth: 0, background: 'linear-gradient(90deg, #fffbeb, #fff)', border: '1px solid #fcd34d', borderRadius: 9, padding: '11px 13px' }
                      : item.kind === 'closing'
                      // Closing : encadré vert, l'entrée la plus marquante du
                      // fil — c'est le contrat signé.
                      ? { flex: 1, minWidth: 0, background: 'linear-gradient(90deg, #f0fdf4, #fff)', border: '1px solid #86efac', borderRadius: 9, padding: '11px 13px' }
                      : item.kind === 'reply'
                      // Réponse du contact : encadré indigo, pour la repérer
                      // immédiatement au milieu des emails partis.
                      ? { flex: 1, minWidth: 0, background: '#f8faff', border: '1px solid #c7d2fe', borderRadius: 9, padding: '11px 13px' }
                      : { flex: 1, minWidth: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9, padding: '11px 13px' }}>
                      {item.kind === 'note' && <NoteItem note={item.data as Note} onSave={editNote} onDelete={deleteNote} />}
                      {item.kind === 'action' && <DoneActionItem action={item.data} onReopen={() => reopenAction(item.data.id)} onDelete={() => deleteAction(item.data.id)} />}
                      {(item.kind === 'email' || item.kind === 'reply') && <EmailLogItem log={item.data as EmailLog} onCancel={cancelScheduledEmail} />}
                      {item.kind === 'offer' && <OfferItem offer={item.data as { offerTitle: string; offerCreatedAt: string }} />}
                      {item.kind === 'move' && <MoveItem move={item.data as DealMove} />}
                      {item.kind === 'demo' && <DemoBookedItem booking={item.data as DemoBooking} onToggleNoShow={toggleNoShow} />}
                      {item.kind === 'closing' && <ClosingItem closing={item.data as ClosingEvent} subscriptions={subs} />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            </>
            )}

            {activeTab === 'abonnement' && (
              <div style={{ maxWidth: 640 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={sectionTitle}>Abonnements ({subs.length}/3)</div>
                  {subs.length > 0 && subs.length < 3 && (
                    <button type="button" onClick={addSub} style={{ ...btnDef, padding: '6px 12px', fontSize: 12 }}>
                      + Ajouter un {subs.length === 1 ? '2ᵉ' : '3ᵉ'} abonnement
                    </button>
                  )}
                </div>

                {subs.length === 0 ? (
                  <div style={{ background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 12, padding: 24, textAlign: 'center', color: '#94a3b8' }}>
                    <div style={{ fontSize: 13, marginBottom: 12 }}>Aucun abonnement sur cette affaire.</div>
                    <button type="button" onClick={addSub} style={{ ...btnPri, padding: '8px 16px', fontSize: 13 }}>+ Créer un abonnement</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {subs.map((s, i) => (
                      <SubscriptionCard key={s.id} sub={s} index={i} subscriptionTypes={subscriptionTypes} users={users} onPatch={patchSub} onDelete={deleteSub} />
                    ))}
                  </div>
                )}

                {subs.length > 0 && (
                  <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                    <span style={{ fontSize: 12.5, color: '#475569' }}>Valeur totale de l&apos;affaire :</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: '#15803d' }}>
                      {formatCurrency(subs.reduce((t, s) => t + (s.value || 0), 0)) || '0 €'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'recrutement' && <RecruitmentTab dealId={dealId} />}

            {activeTab === 'proches' && <NearbyTab dealId={dealId} onNavigate={onNavigate} />}

          </div>
        </div>
      </div>
    </div>

    {/* Pop-ups du changement d'étape depuis la frise — les mêmes que le drag &
        drop du pipeline. Tant qu'elles sont ouvertes, rien n'est enregistré ;
        renoncer laisse l'affaire à son étape actuelle. */}
    {meetInvite && (
      <MeetInviteModal
        storeName={store?.name}
        demoDate={deal.demoDate}
        dealEmail={deal.dealEmail}
        onConfirm={handleMeetConfirm}
        onCancel={() => setMeetInvite(null)}
      />
    )}
    {pvPrompt && <PVModal onConfirm={handlePvConfirm} onCancel={() => setPvPrompt(false)} />}
    {closingPrompt && (
      <ClosingDateModal
        storeName={store?.name}
        targets={closingPrompt.targets}
        users={users}
        onConfirm={handleClosingConfirm}
        onCancel={() => setClosingPrompt(null)}
      />
    )}
    {flowWarn && (
      <FlowWarningModal
        flow={flowWarn.flow}
        isPV={!!deal.isPV}
        storeName={store?.name}
        dealEmail={deal.dealEmail}
        onConfirm={handleFlowConfirm}
        onCancel={() => setFlowWarn(null)}
      />
    )}

    </>
  );
}

function NoteItem({ note, onSave, onDelete }: { note: Note; onSave: (id: string, content: string) => void; onDelete: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  useEffect(() => { setDraft(note.content); }, [note.content]);

  if (editing) {
    return (
      <div>
        <textarea style={{ ...inp, height: 70, resize: 'vertical', marginBottom: 8 }} value={draft} onChange={e => setDraft(e.target.value)} autoFocus />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            style={{ ...btnPri, padding: '5px 12px', fontSize: 12 }}
            onClick={() => { const v = draft.trim(); if (v && v !== note.content) onSave(note.id, v); setEditing(false); }}
          >
            Enregistrer
          </button>
          <button style={{ ...btnDef, padding: '5px 12px', fontSize: 12 }} onClick={() => { setDraft(note.content); setEditing(false); }}>Annuler</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginBottom: 6, color: '#0f172a' }}>{note.content}</p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <p style={{ fontSize: 10.5, color: '#94a3b8', margin: 0 }}>
          {(note as any).authorName ? <span style={{ fontWeight: 600, color: '#64748b' }}>{(note as any).authorName}</span> : <span style={{ fontStyle: 'italic' }}>Anonyme</span>}
          {' · '}{formatDate(note.createdAt)}
        </p>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => setEditing(true)} title="Modifier la note" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 12, padding: 2 }}>✎</button>
          <button onClick={() => onDelete(note.id)} title="Supprimer la note" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 12, padding: 2 }}>🗑</button>
        </div>
      </div>
    </>
  );
}

function DoneActionItem({ action, onReopen, onDelete }: { action: any; onReopen: () => void; onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <button onClick={onReopen} title="Rouvrir l'action" style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #16a34a', background: '#16a34a', color: '#fff', fontSize: 10, cursor: 'pointer', flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', textDecoration: 'line-through' }}>{action.title}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 3, fontSize: 11, color: '#94a3b8', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ background: '#f1f5f9', color: '#64748b', padding: '1px 6px', borderRadius: 3 }}>{action.type}</span>
          <span>Terminée le {formatDate(action.completedAt || action.updatedAt || action.dueDate)}</span>
          {action.assignedUser && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 15, height: 15, borderRadius: '50%', background: action.assignedUser.color, color: '#fff', fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{initials(action.assignedUser.name)}</span>
              {action.assignedUser.name}
            </span>
          )}
        </div>
        {action.note && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{action.note}</div>}
      </div>
      <button onClick={onDelete} style={{ ...btnDef, padding: '2px 6px', fontSize: 11 }}>🗑</button>
    </div>
  );
}

// ── Raccourcis de programmation d'envoi ─────────────────────────────────────
// <input type="datetime-local"> attend une heure LOCALE « YYYY-MM-DDTHH:mm ».
// toISOString() donnerait de l'UTC : décalé d'une ou deux heures en France.
function versChampLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function dansUneMinute(): string {
  return versChampLocal(new Date(Date.now() + 60 * 1000));
}
function dansUneHeure(): string {
  return versChampLocal(new Date(Date.now() + 60 * 60 * 1000));
}
/** Demain à l'heure dite. */
function demainA(heure: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(heure, 0, 0, 0);
  return versChampLocal(d);
}
/** Le prochain lundi à l'heure dite (jamais aujourd'hui). */
function lundiA(heure: number): string {
  const d = new Date();
  const versLundi = (8 - d.getDay()) % 7 || 7;   // 1 = lundi
  d.setDate(d.getDate() + versLundi);
  d.setHours(heure, 0, 0, 0);
  return versChampLocal(d);
}

// Une entrée « email » de la frise, dans les deux sens : email parti du CRM
// (direction « outbound ») ou réponse reçue du contact (« inbound », captée par
// Resend Inbound — cf. src/lib/emailReplies.ts).
function EmailLogItem({ log, onCancel }: { log: EmailLog; onCancel?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isReply = log.direction === 'inbound';
  // Programmé : pas encore parti, donc encore annulable.
  const isScheduled = log.status === 'scheduled';
  const hasFailed = log.status === 'failed';
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#0f172a' }}>{log.subject}</span>
        {isReply
          ? <span style={{ fontSize: 10, background: '#e0e7ff', color: '#4338ca', padding: '2px 6px', borderRadius: 3, flexShrink: 0, fontWeight: 600 }}>💬 Réponse reçue</span>
          : isScheduled
          ? <span style={{ fontSize: 10, background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: 3, flexShrink: 0, fontWeight: 600 }}>🕘 Programmé</span>
          : hasFailed
          ? <span style={{ fontSize: 10, background: '#fee2e2', color: '#b91c1c', padding: '2px 6px', borderRadius: 3, flexShrink: 0, fontWeight: 600 }}>⚠ Échec d'envoi</span>
          : log.status === 'opened'
          ? <span style={{ fontSize: 10, background: '#dbeafe', color: '#1d4ed8', padding: '2px 6px', borderRadius: 3, flexShrink: 0, fontWeight: 600 }}>👁 Ouvert</span>
          : <span style={{ fontSize: 10, background: '#dcfce7', color: '#15803d', padding: '2px 6px', borderRadius: 3, flexShrink: 0, fontWeight: 600 }}>✓ Envoyé</span>
        }
      </div>
      {isReply
        ? <div style={{ fontSize: 11, color: '#64748b' }}>← {log.fromAddress || 'expéditeur inconnu'}</div>
        : <div style={{ fontSize: 11, color: '#64748b' }}>→ {log.to}</div>}
      {log.cc && <div style={{ fontSize: 11, color: '#64748b' }}>Cc : {log.cc}</div>}
      {log.template && <div style={{ fontSize: 10, color: '#94a3b8' }}>Template : {log.template.name}</div>}
      <div style={{ fontSize: 10, color: isScheduled ? '#92400e' : '#94a3b8', marginTop: 2 }}>
        {isScheduled ? `Départ prévu le ${formatDate(log.scheduledAt || log.sentAt)}` : formatDate(log.sentAt)}
        {!isReply && log.openedAt && <span style={{ color: '#1d4ed8' }}> · 👁 Ouvert le {formatDate(log.openedAt)}</span>}
      </div>
      <button onClick={() => setExpanded(!expanded)} style={{ fontSize: 11, color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', textDecoration: 'underline' }}>
        {expanded ? 'Masquer' : isReply ? 'Voir la réponse' : 'Voir le contenu'}
      </button>
      {isScheduled && onCancel && (
        <button onClick={() => onCancel(log.id)} style={{ fontSize: 11, color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0 4px 10px', textDecoration: 'underline' }}>
          Annuler l&apos;envoi
        </button>
      )}
      {expanded && (
        isHtml(log.body)
          ? <div style={{ marginTop: 6, padding: '10px 12px', background: '#f8fafc', borderRadius: 6, fontSize: 12, color: '#334155', borderLeft: `3px solid ${isReply ? '#4338ca' : '#6366f1'}` }} dangerouslySetInnerHTML={{ __html: log.body }} />
          : <div style={{ marginTop: 6, padding: '10px 12px', background: '#f8fafc', borderRadius: 6, fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', borderLeft: `3px solid ${isReply ? '#4338ca' : '#6366f1'}` }}>{log.body}</div>
      )}
    </div>
  );
}

function OfferItem({ offer }: { offer: { offerTitle: string; offerCreatedAt: string } }) {
  // Entrée volontairement discrète (non encadrée, estompée) : information de
  // contexte à ne pas confondre avec les notes / actions / emails du CRM.
  return (
    <div>
      <p style={{ fontSize: 12, margin: 0, color: '#94a3b8' }}>
        Nouvelle offre créée : <span style={{ fontWeight: 600, color: '#64748b' }}>{offer.offerTitle || 'Offre'}</span>
        <span style={{ color: '#cbd5e1' }}> · {formatDate(offer.offerCreatedAt)}</span>
      </p>
    </div>
  );
}

/** Ligne festive d'une démo bookée (une ligne DemoBooking) : qui a booké, quand,
 *  pour quelle date de démo, et la case NO SHOW si le contact n'est pas venu.
 *  Chaque rebooking a sa propre ligne : le no-show se coche démo par démo. */
function DemoBookedItem({ booking, onToggleNoShow }: {
  booking: DemoBooking;
  onToggleNoShow: (bookingId: string, noShow: boolean) => void;
}) {
  const demo = booking.demoDate ? new Date(booking.demoDate) : null;
  const demoValid = demo && !isNaN(demo.getTime());
  const heure = demoValid
    ? demo.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13.5, margin: 0, fontWeight: 700, color: booking.noShow ? '#9f1239' : '#92400e' }}>
          {booking.noShow ? '🚫' : '🎉'} Démo bookée le {formatDate(booking.bookedAt)}
          {demoValid
            ? <> pour le <span style={{ color: booking.noShow ? '#be123c' : '#b45309' }}>{formatDate(booking.demoDate)}{heure && heure !== '00:00' ? ` à ${heure}` : ''}</span></>
            : <span style={{ fontWeight: 500, color: '#a16207' }}> — date de démo à renseigner</span>}
        </p>
        <p style={{ fontSize: 11.5, margin: '4px 0 0', color: '#a16207' }}>
          Bookée par <span style={{ fontWeight: 600 }}>{booking.userName || 'utilisateur inconnu'}</span>
          {booking.doneByName && (
            <span title={booking.doneAt ? `Démo faite le ${formatDate(booking.doneAt)}` : undefined}>
              {' · '}Faite par <span style={{ fontWeight: 600 }}>{booking.doneByName}</span>
            </span>
          )}
          {booking.noShow && <span style={{ color: '#be123c', fontWeight: 700 }}> · NO SHOW</span>}
        </p>
      </div>
      <label
        title="Le contact n'est pas venu à cette démo"
        style={{
          display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, cursor: 'pointer', userSelect: 'none',
          fontSize: 10.5, fontWeight: 800, letterSpacing: '.4px',
          color: booking.noShow ? '#be123c' : '#a16207',
          background: booking.noShow ? '#ffe4e6' : '#fff',
          border: `1px solid ${booking.noShow ? '#fda4af' : '#fcd34d'}`,
          borderRadius: 7, padding: '5px 9px',
        }}
      >
        <input
          type="checkbox"
          checked={booking.noShow}
          onChange={e => onToggleNoShow(booking.id, e.target.checked)}
          style={{ width: 14, height: 14, accentColor: '#e11d48', cursor: 'pointer', margin: 0 }}
        />
        NO SHOW
      </label>
    </div>
  );
}

/** Ligne d'un closing enregistré (une ligne ClosingEvent) : quel abonnement a
 *  été validé, pour quelle date de closing, par qui — et quand l'évènement a
 *  été enregistré, qui peut différer de la date de closing saisie.
 *
 *  Le rang de l'abonnement (« Abonnement 2 ») est retrouvé dans la liste des
 *  abonnements de l'affaire ; l'évènement garde de son côté le type et le
 *  montant photographiés au closing, qui restent lisibles si l'abonnement a été
 *  modifié ou supprimé depuis. */
function ClosingItem({ closing, subscriptions }: {
  closing: ClosingEvent;
  subscriptions: { id: string }[];
}) {
  const rank = subscriptions.findIndex(s => s.id === closing.subscriptionId) + 1;
  const details = [closing.subscriptionType, closing.value != null ? formatCurrency(closing.value) : '']
    .filter(Boolean)
    .join(' · ');
  // Le closing est presque toujours enregistré le jour même : on ne rappelle la
  // date d'enregistrement que lorsqu'elle diffère de la date de closing saisie.
  const sameDay = formatDate(closing.recordedAt) === formatDate(closing.closingDate);
  return (
    <div>
      <p style={{ fontSize: 13.5, margin: 0, fontWeight: 700, color: '#166534' }}>
        🤝 Closing du <span style={{ color: '#15803d' }}>{formatDate(closing.closingDate)}</span>
        {rank > 0 && <> — abonnement {rank}</>}
      </p>
      <p style={{ fontSize: 11.5, margin: '4px 0 0', color: '#15803d' }}>
        Closé par <span style={{ fontWeight: 600 }}>{closing.userName || 'closeur non renseigné'}</span>
        {details && <span style={{ color: '#16a34a' }}> · {details}</span>}
        {!sameDay && <span style={{ color: '#16a34a' }}> · enregistré le {formatDate(closing.recordedAt)}</span>}
      </p>
    </div>
  );
}

/** Un changement d'étape dans le flux d'activité. Le pipeline n'est précisé que
 *  s'il a lui aussi changé (sinon la ligne devient illisible pour un simple
 *  passage d'étape au sein du même pipeline). */
function MoveItem({ move }: { move: DealMove }) {
  const crossPipeline = !!move.fromPipelineName && !!move.toPipelineName
    && move.fromPipelineName !== move.toPipelineName;
  const label = (col: string, pipe: string) =>
    crossPipeline && pipe ? `${pipe} › ${col || '—'}` : (col || '—');
  const author = move.source === 'import'
    ? 'import automatique'
    : (move.userName || 'utilisateur inconnu');
  return (
    <div>
      <p style={{ fontSize: 12, margin: 0, color: '#94a3b8' }}>
        Déplacée de <span style={{ fontWeight: 600, color: '#64748b' }}>{label(move.fromColumnTitle, move.fromPipelineName)}</span>
        {' '}vers <span style={{ fontWeight: 600, color: '#64748b' }}>{label(move.toColumnTitle, move.toPipelineName)}</span>
        <span style={{ color: '#cbd5e1' }}> · {author} · {formatDate(move.movedAt)}</span>
      </p>
    </div>
  );
}

// ---- Onglet « Magasins proches » -------------------------------------------
// Liste les magasins du CRM situés à moins de 50 km (distance Haversine sur les
// coordonnées géocodées), filtrables par enseigne, avec l'étape de pipeline du
// deal associé. Clic → ouvre la fiche du magasin proche.
interface NearbyDealItem {
  dealId: string;
  storeName: string;
  brandName: string | null;
  brandColor: string | null;
  city: string;
  postalCode: string;
  columnTitle: string;
  columnColor: string;
  pipelineName: string;
  distanceKm: number;
}

function NearbyTab({ dealId, onNavigate }: { dealId: string; onNavigate?: (dealId: string) => void }) {
  const [items, setItems] = useState<NearbyDealItem[]>([]);
  const [originLocated, setOriginLocated] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [brand, setBrand] = useState('');
  const [pipeline, setPipeline] = useState('');
  const [allPipelines, setAllPipelines] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false);
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/nearby`);
        if (!res.ok) throw new Error();
        const d = await res.json();
        if (cancelled) return;
        setItems(d.deals || []);
        setOriginLocated(d.originLocated !== false);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dealId]);

  // Liste complète des pipelines du CRM (pour pouvoir filtrer sur n'importe
  // lequel, même sans magasin proche dans ce pipeline).
  useEffect(() => {
    fetch('/api/pipelines')
      .then((r) => r.json())
      .then((d) => setAllPipelines((d.pipelines || []).map((p: any) => p.name)))
      .catch(() => {});
  }, []);

  // Enseignes présentes (pour le filtre), triées par nombre de magasins.
  const brands = useMemo(() => {
    const map = new Map<string, { name: string; color: string; count: number }>();
    for (const it of items) {
      const name = it.brandName || 'Sans enseigne';
      const entry = map.get(name) || { name, color: it.brandColor || '#94a3b8', count: 0 };
      entry.count += 1;
      map.set(name, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [items]);

  // Filtre pipeline : tous les pipelines du CRM, avec le nombre de magasins
  // proches dans chacun (0 si aucun). On complète par d'éventuels pipelines
  // présents dans les résultats mais absents de la liste chargée.
  const pipelines = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) {
      const name = it.pipelineName || '—';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    const names = Array.from(new Set(allPipelines.concat(Array.from(counts.keys()))));
    return names.map((name) => ({ name, count: counts.get(name) || 0 }));
  }, [items, allPipelines]);

  const visible = useMemo(
    () => items.filter((it) =>
      (!brand || (it.brandName || 'Sans enseigne') === brand) &&
      (!pipeline || (it.pipelineName || '—') === pipeline),
    ),
    [items, brand, pipeline],
  );

  if (loading) return <p style={{ color: '#94a3b8', fontSize: 13 }}>Chargement des magasins proches…</p>;
  if (error) return <p style={{ color: '#b91c1c', fontSize: 13 }}>Impossible de charger les magasins proches.</p>;
  if (!originLocated) return (
    <p style={{ color: '#94a3b8', fontSize: 13 }}>
      Ce magasin n&apos;est pas encore géolocalisé : impossible de calculer les distances. Vérifiez son adresse, puis ouvrez la carte pour déclencher le géocodage.
    </p>
  );

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#475569' }}>
          <strong style={{ color: '#4338ca' }}>{visible.length}</strong> magasin{visible.length > 1 ? 's' : ''} à moins de 50&nbsp;km
        </span>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <select value={pipeline} onChange={(e) => setPipeline(e.target.value)} style={{ ...inp, width: 'auto', padding: '6px 10px', fontSize: 12.5 }}>
            <option value="">Tous les pipelines</option>
            {pipelines.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.count})</option>)}
          </select>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} style={{ ...inp, width: 'auto', padding: '6px 10px', fontSize: 12.5 }}>
            <option value="">Toutes les enseignes</option>
            {brands.map((b) => <option key={b.name} value={b.name}>{b.name} ({b.count})</option>)}
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Aucun magasin à moins de 50&nbsp;km{brand || pipeline ? ' pour ce filtre' : ''}.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {visible.map((it) => (
            <button
              key={it.dealId}
              onClick={() => onNavigate?.(it.dealId)}
              title={onNavigate ? `Ouvrir ${it.storeName}` : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9, padding: '11px 13px',
                cursor: onNavigate ? 'pointer' : 'default',
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: it.brandColor || '#94a3b8', border: (it.brandColor || '').toLowerCase() === '#ffffff' ? '1px solid #cbd5e1' : 'none' }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {it.storeName}
                </span>
                <span style={{ display: 'block', fontSize: 11.5, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {[it.brandName, it.city].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#4338ca' }}>{it.distanceKm.toLocaleString('fr-FR')} km</span>
                <span title={`Pipeline « ${it.pipelineName} »`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, color: '#334155', background: '#f1f5f9', padding: '2px 8px', borderRadius: 999 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: it.columnColor || '#94a3b8' }} />
                  {it.columnTitle || '—'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ---- Onglet « Recrutement » ------------------------------------------------
// Regroupe par Organization produit (auto en « Démo prévue » ou ajoutée
// manuellement) les offres et leurs candidats likés. Gestion manuelle des
// organisations rattachées (ajout / retrait d'un organization_id).
interface RecruitmentCandidate { id: string; firstName: string; lastName: string; phoneNumber: string; }
interface RecruitmentOffer { id: string; title: string; candidates: RecruitmentCandidate[]; }
interface RecruitmentOrganization { organizationId: string; organizationName: string; offers: RecruitmentOffer[]; }
interface RecruitmentData { configured: boolean; organizations: RecruitmentOrganization[]; calledCandidateIds?: string[]; primaryOrganizationId?: string | null; manual?: boolean; }

function RecruitmentTab({ dealId }: { dealId: string }) {
  const [data, setData] = useState<RecruitmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [calledIds, setCalledIds] = useState<Set<string>>(new Set());
  // Saisie manuelle d'un organization_id (organisation secondaire).
  const [newOrgId, setNewOrgId] = useState('');
  const [addingOrg, setAddingOrg] = useState(false);
  // Saisie / modification de l'organisation principale (id figé sur le deal).
  const [newPrimaryId, setNewPrimaryId] = useState('');
  const [savingPrimary, setSavingPrimary] = useState(false);
  // Création à la demande de l'Organization Supabase (bouton « Créer l'organisation »).
  const [provisioning, setProvisioning] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch(`/api/deals/${dealId}/recruitment`);
      if (!res.ok) throw new Error();
      const d = await res.json();
      setData(d);
      setCalledIds(new Set(d.calledCandidateIds || []));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const toggleCall = async (candidateId: string) => {
    const called = !calledIds.has(candidateId);
    setCalledIds(prev => {
      const next = new Set(prev);
      if (called) next.add(candidateId); else next.delete(candidateId);
      return next;
    });
    try {
      const res = await fetch(`/api/deals/${dealId}/recruitment/calls`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId, called }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setCalledIds(prev => {
        const next = new Set(prev);
        if (called) next.delete(candidateId); else next.add(candidateId);
        return next;
      });
      toast('Échec de l\'enregistrement', 'error');
    }
  };

  const addOrg = async () => {
    const organizationId = newOrgId.trim();
    if (!organizationId) return;
    setAddingOrg(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/organizations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Erreur');
      setNewOrgId('');
      toast('✓ Organisation rattachée');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Échec de l\'ajout', 'error');
    } finally {
      setAddingOrg(false);
    }
  };

  // Fige (ou remplace) l'organisation principale : écrit l'organization_id en
  // dur sur le deal. Ne dépend plus du nom → un renommage Supabase ne casse rien.
  const setPrimary = async (id?: string) => {
    const organizationId = (id ?? newPrimaryId).trim();
    if (!organizationId) return;
    setSavingPrimary(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/organizations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId, primary: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Erreur');
      setNewPrimaryId('');
      toast('✓ Organisation principale enregistrée');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Échec de l\'enregistrement', 'error');
    } finally {
      setSavingPrimary(false);
    }
  };

  // Déclenche le provisioning Supabase (Organization + plan + Recruiter) sans
  // passer l'affaire en « Démo prévue » : même paramétrage que l'automatisme,
  // et idempotent (aucun doublon si l'organisation existe déjà).
  const provisionOrg = async () => {
    if (!window.confirm('Créer l\'Organization et le Recruiter dans Supabase pour cette affaire ?')) return;
    setProvisioning(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/provision-organization`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Erreur');
      toast(body?.created
        ? `✓ Organisation « ${body.organizationName} » créée dans Supabase`
        : 'Organisation déjà créée pour cette affaire');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Échec de la création', 'error');
    } finally {
      setProvisioning(false);
    }
  };

  const removeOrg = async (organizationId: string) => {
    if (!window.confirm('Retirer cette organisation de l\'affaire ?')) return;
    try {
      const res = await fetch(`/api/deals/${dealId}/organizations`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      toast('Échec du retrait', 'error');
    }
  };

  const renderOffer = (offer: RecruitmentOffer) => {
    const open = !!expanded[offer.id];
    return (
      <div key={offer.id} style={{ border: '1px solid #e2e8f0', borderRadius: 9, marginBottom: 8, background: '#fff', overflow: 'hidden' }}>
        <button
          onClick={() => setExpanded(e => ({ ...e, [offer.id]: !e[offer.id] }))}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: open ? '#f5f3ff' : '#fff', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        >
          <span style={{ fontSize: 12, color: '#94a3b8', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>{offer.title}</span>
          <span style={{ fontSize: 11, fontWeight: 600, background: '#ede9fe', color: '#6d28d9', padding: '2px 8px', borderRadius: 999, flexShrink: 0 }}>
            {offer.candidates.length} candidat{offer.candidates.length > 1 ? 's' : ''}
          </span>
        </button>
        {open && (
          <div style={{ borderTop: '1px solid #e2e8f0', padding: '6px 14px 10px' }}>
            {offer.candidates.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: 12.5, margin: '8px 0' }}>Aucun candidat envoyé pour cette offre.</p>
            ) : (
              offer.candidates.map(c => {
                const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
                const called = calledIds.has(c.id);
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <button
                      onClick={() => toggleCall(c.id)}
                      title={called ? 'Appelé — cliquer pour décocher' : 'Marquer comme appelé'}
                      style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${called ? '#16a34a' : '#cbd5e1'}`, background: called ? '#16a34a' : 'transparent', color: '#fff', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, lineHeight: 1 }}
                    >
                      {called ? '✓' : ''}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: called ? '#94a3b8' : (fullName ? '#0f172a' : '#cbd5e1'), textDecoration: called ? 'line-through' : 'none' }}>{fullName || 'Nom inconnu'}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {c.phoneNumber
                          ? <a href={`tel:${c.phoneNumber}`} style={{ color: '#4f46e5', textDecoration: 'none' }}>📞 {c.phoneNumber}</a>
                          : <span style={{ color: '#cbd5e1' }}>Téléphone non renseigné</span>}
                      </div>
                    </div>
                    {called && <span style={{ fontSize: 10.5, color: '#16a34a', fontWeight: 600, flexShrink: 0 }}>Appelé</span>}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) return <p style={{ color: '#94a3b8', fontSize: 13 }}>Chargement du recrutement…</p>;
  if (error) return <p style={{ color: '#dc2626', fontSize: 13 }}>Erreur lors du chargement des données de recrutement.</p>;
  if (!data?.configured) return <p style={{ color: '#94a3b8', fontSize: 13 }}>Intégration Supabase produit non configurée.</p>;

  const orgs = data.organizations || [];
  const primaryId = data.primaryOrganizationId ?? null;
  const primaryOrg = primaryId ? orgs.find(o => o.organizationId === primaryId) ?? null : null;
  const secondaryOrgs = orgs.filter(o => o.organizationId !== primaryId);

  return (
    <div>
      {/* Gestion des organisations rattachées */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 9, padding: 12, marginBottom: 16, background: '#f8fafc' }}>
        {/* Organisation principale (id figé sur le deal) */}
        <div style={{ ...sectionTitle, marginBottom: 8 }}>Organisation principale</div>
        {primaryId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a' }}>{primaryOrg?.organizationName ?? 'Organisation'}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{primaryId}</div>
            </div>
            <button onClick={() => removeOrg(primaryId)} title="Retirer l'organisation principale" style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '3px 7px', flexShrink: 0 }}>Retirer</button>
          </div>
        ) : (
          <>
            <p style={{ color: '#94a3b8', fontSize: 12.5, margin: '0 0 8px' }}>
              Rattachée automatiquement en « Démo prévue ». Vous pouvez la créer dès maintenant, ou la fixer / la corriger manuellement ci-dessous.
            </p>
            <button
              onClick={provisionOrg}
              disabled={provisioning}
              title="Crée l'Organization, son plan et le Recruiter dans Supabase, sans passer l'affaire en « Démo prévue »"
              style={{ ...btnPri, background: '#16a34a', opacity: provisioning ? .7 : 1, cursor: provisioning ? 'not-allowed' : 'pointer' }}
            >
              {provisioning ? '⟳ Création…' : '＋ Créer l\'organisation dans Supabase'}
            </button>
          </>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            style={{ ...inp, flex: 1, fontSize: 12, fontFamily: 'monospace' }}
            placeholder={primaryId ? 'Remplacer par un autre organization_id' : 'organization_id principal (UUID)'}
            value={newPrimaryId}
            onChange={e => setNewPrimaryId(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') setPrimary(); }}
          />
          <button style={{ ...btnPri, opacity: savingPrimary ? .7 : 1, cursor: savingPrimary ? 'not-allowed' : 'pointer' }} onClick={() => setPrimary()} disabled={savingPrimary}>
            {savingPrimary ? '⟳' : (primaryId ? 'Remplacer' : 'Définir')}
          </button>
        </div>

        {/* Organisations secondaires */}
        <div style={{ ...sectionTitle, marginTop: 16, marginBottom: 8 }}>Organisations secondaires</div>
        {secondaryOrgs.length === 0 && (
          <p style={{ color: '#94a3b8', fontSize: 12.5, margin: '0 0 8px' }}>
            Aucune organisation secondaire. Ajoutez un <code>organization_id</code> pour rattacher une organisation supplémentaire.
          </p>
        )}
        {secondaryOrgs.map(o => (
          <div key={o.organizationId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a' }}>{o.organizationName}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.organizationId}</div>
            </div>
            <button onClick={() => setPrimary(o.organizationId)} title="Définir comme principale" style={{ background: 'none', border: '1px solid #c7d2fe', color: '#4f46e5', borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '3px 7px', flexShrink: 0 }}>Principale</button>
            <button onClick={() => removeOrg(o.organizationId)} title="Retirer" style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '3px 7px', flexShrink: 0 }}>Retirer</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            style={{ ...inp, flex: 1, fontSize: 12, fontFamily: 'monospace' }}
            placeholder="organization_id Supabase (UUID)"
            value={newOrgId}
            onChange={e => setNewOrgId(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addOrg(); }}
          />
          <button style={{ ...btnPri, opacity: addingOrg ? .7 : 1, cursor: addingOrg ? 'not-allowed' : 'pointer' }} onClick={addOrg} disabled={addingOrg}>
            {addingOrg ? '⟳' : 'Ajouter'}
          </button>
        </div>
      </div>

      {/* Offres regroupées par organisation */}
      {orgs.map(o => (
        <div key={o.organizationId} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>🏢 {o.organizationName}</span>
            {o.organizationId === primaryId
              ? <span style={{ fontSize: 10, fontWeight: 600, background: '#eef2ff', color: '#4338ca', padding: '1px 6px', borderRadius: 999 }}>Principale</span>
              : <span style={{ fontSize: 10, fontWeight: 600, background: '#f1f5f9', color: '#64748b', padding: '1px 6px', borderRadius: 999 }}>Secondaire</span>}
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{o.offers.length} offre{o.offers.length > 1 ? 's' : ''}</span>
          </div>
          {o.offers.length === 0
            ? <p style={{ color: '#94a3b8', fontSize: 12.5, margin: '0 0 4px' }}>Aucune offre pour cette organisation.</p>
            : o.offers.map(renderOffer)}
        </div>
      ))}
    </div>
  );
}
