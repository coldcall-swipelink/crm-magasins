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
import { LEAD_STATUSES, statusColor, statusLabel } from '@/lib/campaigns/leadFields';

const inp: React.CSSProperties = { width: '100%', padding: '6px 9px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: 12.5, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '6px 12px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 12.5 };
const btnDef: React.CSSProperties = { padding: '6px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 12.5 };
const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 3 };

export interface LeadRow {
  id: string; email: string; civility: string | null; firstName: string | null; lastName: string | null;
  jobTitle: string | null; company: string | null; phone: string | null; website: string | null;
  city: string | null; country: string | null; customFields: Record<string, string>;
  status: string; source: string | null;
  lastContactedAt: string | null; lastOpenedAt: string | null; lastRepliedAt: string | null;
  createdAt: string;
}

type FullLead = LeadRow & {
  notes: Array<{ id: string; body: string; userName: string | null; createdAt: string }>;
  events: Array<{ id: string; type: string; label: string; userName: string | null; createdAt: string }>;
  import: { id: string; filename: string; createdAt: string } | null;
};

const EDITABLE = [
  ['civility', 'Civilité'], ['firstName', 'Prénom'], ['lastName', 'Nom'],
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

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/leads/${leadId}`);
    if (!res.ok) { toast('Lead introuvable', 'error'); onClose(); return; }
    const data = await res.json();
    setLead(data.lead);
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
    if (!res.ok) { toast(data.error || 'Modification refusée', 'error'); return; }
    setLead(data.lead);
    setDirty(false);
    onChanged();
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

  const remove = async () => {
    if (!lead || !confirm(`Supprimer définitivement ${lead.email} ?`)) return;
    const res = await fetch(`/api/campaigns/leads/${leadId}`, { method: 'DELETE' });
    if (!res.ok) { toast('Suppression impossible', 'error'); return; }
    toast('Lead supprimé');
    onChanged();
    onClose();
  };

  if (!lead) {
    return <aside style={panelStyle}><div style={{ padding: 20, fontSize: 13, color: '#94a3b8' }}>Chargement…</div></aside>;
  }

  const custom = Object.entries(lead.customFields || {});

  return (
    <aside style={panelStyle}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {[lead.civility, lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{lead.email}</div>
          {lead.company && <div style={{ fontSize: 12, color: '#64748b' }}>{lead.jobTitle ? `${lead.jobTitle} · ` : ''}{lead.company}</div>}
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
                border: `1px solid ${active ? status.color : '#e2e8f0'}`,
                background: active ? `${status.color}18` : '#f8fafc',
                color: active ? status.color : '#64748b',
              }}>{status.label}</button>
            );
          })}
        </div>

        <div style={label}>INFORMATIONS</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          {EDITABLE.map(([key, text]) => (
            <div key={key}>
              <label style={label}>{text}</label>
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
            <div style={{ border: '1px solid #f1f5f9', borderRadius: 8, marginBottom: 16 }}>
              {custom.map(([key, value]) => (
                <div key={key} style={{ display: 'flex', gap: 8, padding: '5px 10px', borderBottom: '1px solid #f8fafc', fontSize: 12 }}>
                  <code style={{ color: '#4f46e5', flexShrink: 0 }}>{`{{${key}}}`}</code>
                  <span style={{ color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={label}>NOTES</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <textarea style={{ ...inp, minHeight: 54, resize: 'vertical' }} placeholder="Ajouter une note…"
            value={note} onChange={e => setNote(e.target.value)} />
          <button style={{ ...btnPri, alignSelf: 'flex-start' }} onClick={addNote}>Ajouter</button>
        </div>
        {lead.notes.map(item => (
          <div key={item.id} style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '7px 10px', marginBottom: 6 }}>
            <div style={{ fontSize: 12.5, color: '#0f172a', whiteSpace: 'pre-wrap' }}>{item.body}</div>
            <div style={{ fontSize: 10.5, color: '#a16207', marginTop: 3 }}>
              {item.userName ? `${item.userName} · ` : ''}{formatDate(item.createdAt)}
            </div>
          </div>
        ))}

        <div style={{ ...label, marginTop: 16 }}>ACTIVITÉ</div>
        {lead.events.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>Rien à afficher.</div>}
        {lead.events.map(event => (
          <div key={event.id} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '5px 0', borderBottom: '1px solid #f8fafc' }}>
            <span>{EVENT_ICONS[event.type] || '•'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#334155' }}>{event.label || event.type}</div>
              <div style={{ fontSize: 10.5, color: '#94a3b8' }}>
                {event.userName ? `${event.userName} · ` : ''}{formatDate(event.createdAt)}
              </div>
            </div>
          </div>
        ))}

        <div style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid #f1f5f9', fontSize: 11, color: '#94a3b8' }}>
          Statut actuel : <strong style={{ color: statusColor(lead.status) }}>{statusLabel(lead.status)}</strong><br />
          Ajouté le {formatDate(lead.createdAt)}
          {lead.source ? ` · Provenance : ${lead.source}` : ''}
          {lead.import ? ` · Fichier : ${lead.import.filename}` : ''}
        </div>

        <button style={{ ...btnDef, marginTop: 14, borderColor: '#fecaca', background: '#fef2f2', color: '#b91c1c' }}
          onClick={remove}>Supprimer ce lead</button>
      </div>
    </aside>
  );
}

const panelStyle: React.CSSProperties = {
  width: 420, flexShrink: 0, height: '100%', background: '#fff',
  borderLeft: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', overflow: 'hidden',
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
