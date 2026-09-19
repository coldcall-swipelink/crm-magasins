'use client';
// src/components/campaigns/LeadDrawer.tsx
//
// Fiche d'un lead, ouverte sur le côté depuis la liste : ses informations, son
// statut commercial, ses notes et sa frise d'activité.
//
// C'est ici que se fait le suivi un par un demandé pour l'outil : marquer un
// lead intéressé ou pas intéressé, lui ajouter une note, le désinscrire.

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import LinkConfirmModal, { type LinkMode, type LinkPreview } from '@/components/ui/LinkConfirmModal';
import { LEAD_STATUSES, statusColor, statusLabel } from '@/lib/campaigns/leadFields';
import { ENROLLMENT_STATUS, STOP_REASONS, btnDef, btnPri, inp, label } from './ui';


export interface LeadRow {
  id: string; email: string; civility: string | null; firstName: string | null; lastName: string | null;
  /** « Contact calling » de la fiche affaire, repris du CRM. */
  contactCalling: string | null;
  jobTitle: string | null; company: string | null; phone: string | null; website: string | null;
  city: string | null; country: string | null; customFields: Record<string, string>;
  status: string; source: string | null;
  lastContactedAt: string | null; lastOpenedAt: string | null; lastRepliedAt: string | null;
  createdAt: string;
  /**
   * Situation de l'affaire liée dans le CRM, jointe par la liste des leads.
   * `null` quand le lead ne vient d'aucune affaire (import CSV, saisie).
   */
  crm?: { dealId: string; pipeline: string; column: string; color: string } | null;
}

type Enrollment = {
  id: string; status: string; stopReason: string | null; sentSteps: number; nextSendAt: string | null;
  campaign: { id: string; name: string; status: string };
  mailbox: { email: string } | null;
};

type Reply = { id: string; subject: string; snippet: string; receivedAt: string };

type FullLead = LeadRow & {
  notes: Array<{ id: string; body: string; userName: string | null; createdAt: string }>;
  events: Array<{ id: string; type: string; label: string; userName: string | null; createdAt: string }>;
  import: { id: string; filename: string; createdAt: string } | null;
  enrollments: Enrollment[];
  replies: Reply[];
};

const EDITABLE = [
  ['email', 'Email'],
  ['civility', 'Civilité'], ['firstName', 'Prénom'], ['lastName', 'Nom'],
  ['contactCalling', 'Contact calling'],
  ['jobTitle', 'Poste'], ['company', 'Enseigne'], ['phone', 'Téléphone'],
  ['city', 'Ville'], ['website', 'Site web'],
] as const;

const EVENT_ICONS: Record<string, string> = {
  imported: '📥', updated: '✏️', status_changed: '🏷️', note_added: '📝',
  email_sent: '📤', email_opened: '👁️', replied: '💬',
  unsubscribed: '🚫', bounced: '⚠️', enrolled: '🎯', stopped: '⏹️',
};

export default function LeadDrawer({ leadId, userName, onClose, onChanged }: {
  leadId: string;
  userName?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [lead, setLead] = useState<FullLead | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  // Répercussion en attente de confirmation : ce que le serveur a refusé
  // d'appliquer tant qu'on n'a pas vu ce que ça changerait sur l'affaire.
  const [pendingLink, setPendingLink] = useState<{ link: LinkPreview; payload: Record<string, unknown> } | null>(null);
  const [confirming, setConfirming] = useState(false);
  // L'affaire du CRM liée à ce lead, et les champs qu'ils partagent. Null :
  // aucune affaire, les modifications restent dans Campagnes.
  const [crmLink, setCrmLink] = useState<{ dealId: string; target: string; sharedFields: string[] } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/leads/${leadId}`);
    if (!res.ok) { toast('Lead introuvable', 'error'); onClose(); return; }
    const data = await res.json();
    setLead(data.lead);
    setCrmLink(data.link ?? null);
    setDraft(Object.fromEntries(EDITABLE.map(([key]) => [key, data.lead[key] || ''])));
    setDirty(false);
  }, [leadId, onClose]);

  useEffect(() => { load(); }, [load]);

  const patch = async (payload: Record<string, unknown>) => {
    const res = await fetch(`/api/campaigns/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, userName }),
    });
    const data = await res.json();

    // Le serveur refuse tant que la répercussion sur l'affaire n'est pas vue
    // et confirmée : on montre ce qu'elle changerait, puis on renvoie.
    if (res.status === 409 && data.requiresConfirmation) {
      setPendingLink({ link: data.link, payload });
      return;
    }
    if (!res.ok) { toast(data.error || 'Modification refusée', 'error'); return; }

    setLead(data.lead);
    setDirty(false);
    onChanged();
  };

  /**
   * Deuxième passage, une fois l'écran tranché : « both » répercute sur
   * l'affaire, « side » n'enregistre que le lead. Le mode choisi doit
   * voyager tel quel — l'envoyer toujours comme « both » faisait répercuter
   * une modification qu'on avait justement demandé de garder ici.
   */
  const confirmLink = async (mode: LinkMode) => {
    if (!pendingLink) return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/campaigns/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...pendingLink.payload, userName, linkMode: mode }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Modification refusée', 'error'); return; }

      setLead(data.lead);
      setDirty(false);
      setPendingLink(null);
      toast(mode === 'both'
        ? "Modification appliquée au lead et à l'affaire du CRM"
        : "Lead modifié — l'affaire du CRM reste en l'état");
      onChanged();
    } finally {
      setConfirming(false);
    }
  };

  const addNote = async () => {
    const body = note.trim();
    if (!body) return;
    const res = await fetch(`/api/campaigns/leads/${leadId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, userName }),
    });
    if (!res.ok) { toast('Note non enregistrée', 'error'); return; }
    setNote('');
    load();
  };

  /** Pilotage d'UNE séquence depuis la fiche du lead. */
  const actOnEnrollment = async (enrollment: Enrollment, action: 'pause' | 'resume' | 'stop') => {
    const res = await fetch(`/api/campaigns/${enrollment.campaign.id}/enrollments/${enrollment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, userName }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Action impossible', 'error'); return; }
    load();
    onChanged();
  };

  /** Retire le lead d'UNE campagne : son inscription part, le lead reste. */
  const removeFromCampaign = async (enrollment: Enrollment) => {
    const sent = enrollment.sentSteps > 0
      ? `Les ${enrollment.sentSteps} email${enrollment.sentSteps > 1 ? 's' : ''} déjà envoyé${enrollment.sentSteps > 1 ? 's' : ''} disparaîtront des statistiques de la campagne. `
      : '';
    if (!confirm(`Retirer ce lead de « ${enrollment.campaign.name} » ?\n\n${sent}Le lead reste dans votre liste de leads.`)) return;
    const params = new URLSearchParams();
    if (userName) params.set('userName', userName);
    const res = await fetch(`/api/campaigns/${enrollment.campaign.id}/enrollments/${enrollment.id}?${params}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || 'Retrait impossible', 'error'); return; }
    toast('Lead retiré de la campagne');
    load();
    onChanged();
  };

  const remove = async () => {
    if (!lead || !confirm(`Supprimer définitivement ${lead.email} ?`)) return;
    const res = await fetch(`/api/campaigns/leads/${leadId}`, { method: 'DELETE' });
    if (!res.ok) { toast('Suppression impossible', 'error'); return; }
    toast('Lead supprimé');
    onChanged();
    onClose();
  };

  if (!lead) {
    return <aside style={panelStyle}><div style={{ padding: 20, fontSize: 13, color: '#6b7283' }}>Chargement…</div></aside>;
  }

  const confirmation = pendingLink && (
    <LinkConfirmModal
      link={pendingLink.link}
      dark
      busy={confirming}
      onConfirm={confirmLink}
      onCancel={() => { setPendingLink(null); load(); }}
    />
  );

  const custom = Object.entries(lead.customFields || {});

  return (
    <aside style={panelStyle}>
      {confirmation}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #262b38', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {[lead.civility, lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email}
          </div>
          <div style={{ fontSize: 12, color: '#9aa1b4', marginTop: 2 }}>{lead.email}</div>
          {lead.company && <div style={{ fontSize: 12, color: '#9aa1b4' }}>{lead.jobTitle ? `${lead.jobTitle} · ` : ''}{lead.company}</div>}
        </div>
        <button onClick={onClose} style={{ ...btnDef, padding: '3px 9px' }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {/* Statut : l'action principale de la fiche, donc tout en haut. */}
        <div style={label}>STATUT</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 16 }}>
          {LEAD_STATUSES.map(status => {
            const active = lead.status === status.key;
            return (
              <button key={status.key} onClick={() => patch({ status: status.key })} style={{
                padding: '4px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 11.5,
                fontWeight: active ? 700 : 500,
                border: `1px solid ${active ? status.color : '#262b38'}`,
                background: active ? `${status.color}18` : '#1c1f2a',
                color: active ? status.color : '#9aa1b4',
              }}>{status.label}</button>
            );
          })}
        </div>

        <div style={label}>INFORMATIONS</div>
        {/* Liaison avec le CRM, dite d'avance : on sait AVANT de modifier si
            la fiche affaire suivra, et pour quels champs. */}
        {crmLink ? (
          <div style={{ fontSize: 11.5, color: '#9aa1b4', background: 'rgba(59,113,245,.10)', border: '1px solid rgba(59,113,245,.30)', borderRadius: 8, padding: '8px 11px', marginBottom: 10, lineHeight: 1.55 }}>
            <span style={{ color: '#8fb0ff', fontWeight: 600 }}>Lié à {crmLink.target}</span> dans le CRM.
            Les champs marqués <span style={{ color: '#8fb0ff', fontWeight: 600 }}>CRM</span> se répercutent sur
            la fiche affaire, après confirmation. Prénom, enseigne, ville et site web restent propres au lead.
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: '#6b7283', marginBottom: 10, lineHeight: 1.55 }}>
            Aucune affaire du CRM liée à ce lead : les modifications restent dans Campagnes.
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          {EDITABLE.map(([key, text]) => (
            <div key={key}>
              <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 5 }}>
                {text}
                {crmLink?.sharedFields.includes(key) && (
                  <span title="Partagé avec la fiche affaire du CRM"
                    style={{ fontSize: 9, fontWeight: 700, color: '#8fb0ff', background: 'rgba(59,113,245,.16)', borderRadius: 4, padding: '0 4px', letterSpacing: '.04em' }}>
                    CRM
                  </span>
                )}
              </label>
              <input style={inp} value={draft[key] || ''}
                onChange={e => { setDraft({ ...draft, [key]: e.target.value }); setDirty(true); }} />
            </div>
          ))}
        </div>
        {dirty && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            <button style={btnPri} onClick={() => patch(draft)}>Enregistrer</button>
            <button style={btnDef} onClick={load}>Annuler</button>
          </div>
        )}

        {custom.length > 0 && (
          <>
            <div style={label}>CHAMPS PERSONNALISÉS (variables)</div>
            <div style={{ border: '1px solid #222634', borderRadius: 8, marginBottom: 16 }}>
              {custom.map(([key, value]) => (
                <div key={key} style={{ display: 'flex', gap: 8, padding: '5px 10px', borderBottom: '1px solid #1c1f2a', fontSize: 12 }}>
                  <code style={{ color: '#3b71f5', flexShrink: 0 }}>{`{{${key}}}`}</code>
                  <span style={{ color: '#b3b9c9', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {lead.enrollments.length > 0 && (
          <>
            <div style={label}>CAMPAGNES</div>
            {lead.enrollments.map(enrollment => {
              const state = ENROLLMENT_STATUS[enrollment.status] || { label: enrollment.status, color: '#9aa1b4' };
              return (
                <div key={enrollment.id} style={{ border: '1px solid #262b38', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {enrollment.campaign.name}
                    </span>
                    <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, color: state.color, background: `${state.color}18` }}>
                      {state.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7283', marginTop: 3 }}>
                    {enrollment.sentSteps} email{enrollment.sentSteps > 1 ? 's' : ''} envoyé{enrollment.sentSteps > 1 ? 's' : ''}
                    {enrollment.mailbox ? ` · ${enrollment.mailbox.email}` : ''}
                    {enrollment.stopReason ? ` · ${STOP_REASONS[enrollment.stopReason] || enrollment.stopReason}` : ''}
                    {enrollment.nextSendAt && enrollment.status === 'active'
                      ? ` · prochain le ${formatDate(enrollment.nextSendAt)}`
                      : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 5, marginTop: 7 }}>
                    {enrollment.status === 'active' && (
                      <button style={{ ...btnDef, padding: '3px 9px', fontSize: 11.5 }}
                        onClick={() => actOnEnrollment(enrollment, 'pause')}>Pause</button>
                    )}
                    {(enrollment.status === 'paused' || enrollment.status === 'stopped') && (
                      <button style={{ ...btnDef, padding: '3px 9px', fontSize: 11.5 }}
                        onClick={() => actOnEnrollment(enrollment, 'resume')}>Reprendre</button>
                    )}
                    {enrollment.status !== 'stopped' && enrollment.status !== 'finished' && (
                      <button style={{ ...btnDef, padding: '3px 9px', fontSize: 11.5, borderColor: 'rgba(239,68,68,.35)', background: 'rgba(239,68,68,.13)', color: '#f87171' }}
                        onClick={() => actOnEnrollment(enrollment, 'stop')}>Arrêter pour ce lead</button>
                    )}
                    <button style={{ ...btnDef, padding: '3px 9px', fontSize: 11.5, color: '#f87171', marginLeft: 'auto' }}
                      title="Retirer ce lead de la campagne (il reste dans la liste des leads)"
                      onClick={() => removeFromCampaign(enrollment)}>Retirer de la campagne</button>
                  </div>
                </div>
              );
            })}
            <div style={{ height: 10 }} />
          </>
        )}

        {lead.replies.length > 0 && (
          <>
            <div style={label}>RÉPONSES REÇUES</div>
            {lead.replies.map(reply => (
              <div key={reply.id} style={{ background: 'rgba(139,92,246,.13)', border: '1px solid rgba(139,92,246,.35)', borderRadius: 8, padding: '7px 10px', marginBottom: 6 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{reply.subject || '(sans objet)'}</div>
                <div style={{ fontSize: 12, color: '#b3b9c9', marginTop: 3 }}>{reply.snippet.slice(0, 260)}</div>
                <div style={{ fontSize: 10.5, color: '#a78bfa', marginTop: 3 }}>{formatDate(reply.receivedAt)}</div>
              </div>
            ))}
            <div style={{ height: 10 }} />
          </>
        )}

        <div style={label}>NOTES</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <textarea style={{ ...inp, minHeight: 54, resize: 'vertical' }} placeholder="Ajouter une note…"
            value={note} onChange={e => setNote(e.target.value)} />
          <button style={{ ...btnPri, alignSelf: 'flex-start' }} onClick={addNote}>Ajouter</button>
        </div>
        {lead.notes.map(item => (
          <div key={item.id} style={{ background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.35)', borderRadius: 8, padding: '7px 10px', marginBottom: 6 }}>
            <div style={{ fontSize: 12.5, color: '#e7e9ef', whiteSpace: 'pre-wrap' }}>{item.body}</div>
            <div style={{ fontSize: 10.5, color: '#d9a441', marginTop: 3 }}>
              {item.userName ? `${item.userName} · ` : ''}{formatDate(item.createdAt)}
            </div>
          </div>
        ))}

        <div style={{ ...label, marginTop: 16 }}>ACTIVITÉ</div>
        {lead.events.length === 0 && <div style={{ fontSize: 12, color: '#6b7283' }}>Rien à afficher.</div>}
        {lead.events.map(event => (
          <div key={event.id} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '5px 0', borderBottom: '1px solid #1c1f2a' }}>
            <span>{EVENT_ICONS[event.type] || '•'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#cdd2df' }}>{event.label || event.type}</div>
              <div style={{ fontSize: 10.5, color: '#6b7283' }}>
                {event.userName ? `${event.userName} · ` : ''}{formatDate(event.createdAt)}
              </div>
            </div>
          </div>
        ))}

        <div style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid #222634', fontSize: 11, color: '#6b7283' }}>
          Statut actuel : <strong style={{ color: statusColor(lead.status) }}>{statusLabel(lead.status)}</strong><br />
          Ajouté le {formatDate(lead.createdAt)}
          {lead.source ? ` · Provenance : ${lead.source}` : ''}
          {lead.import ? ` · Fichier : ${lead.import.filename}` : ''}
        </div>

        <button style={{ ...btnDef, marginTop: 14, borderColor: 'rgba(239,68,68,.35)', background: 'rgba(239,68,68,.13)', color: '#f87171' }}
          onClick={remove}>Supprimer ce lead</button>
      </div>
    </aside>
  );
}

const panelStyle: React.CSSProperties = {
  width: 420, flexShrink: 0, height: '100%', background: '#171a23',
  borderLeft: '1px solid #262b38', display: 'flex', flexDirection: 'column', overflow: 'hidden',
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
