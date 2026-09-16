'use client';
// src/components/campaigns/MessagesHistory.tsx
//
// Historique des emails — passé ET à venir.
//
// Le même écran sert deux échelles : celui d'une campagne (avec campaignId) et
// le général (sans, la colonne « Campagne » apparaît alors). C'est la même
// question posée de deux endroits, elle n'a pas à donner deux écrans à tenir.
//
// « À venir » ne lit pas les mêmes données : un email de campagne n'existe en
// base qu'une fois parti. L'échéance se lit donc sur l'inscription du lead.

import { useCallback, useEffect, useState } from 'react';
import { CAMPAIGN_STATUS, ENROLLMENT_STATUS, STOP_REASONS, btnDef, card, inp } from './ui';

type Message = {
  id: string; subject: string; toAddress: string; fromAddress: string;
  status: string; stepPosition: number; sentAt: string;
  openedAt: string | null; openCount: number; repliedAt: string | null; error: string | null;
  campaign: { id: string; name: string };
  lead: { id: string; firstName: string | null; lastName: string | null; company: string | null; status: string } | null;
  mailbox: { email: string } | null;
};

type Upcoming = {
  id: string; scheduledAt: string; overdue: boolean; enrollmentStatus: string;
  stepPosition: number; stepCount: number; subjectTemplate: string;
  lead: { id: string; email: string; firstName: string | null; lastName: string | null; company: string | null };
  mailbox: { email: string } | null;
  campaign: { id: string; name: string; status: string };
};

type Detail = {
  message: Message & { bodyHtml: string; messageId: string | null; lead: { email: string } | null };
  replies: Array<{ id: string; subject: string; snippet: string; receivedAt: string; fromAddress: string }>;
};

/** Onglets de l'écran. « À venir » d'abord : c'est ce qu'on vient vérifier. */
const TABS = [
  { key: 'upcoming', label: 'À venir' },
  { key: '',         label: 'Tous les envois' },
  { key: 'opened',   label: 'Ouverts' },
  { key: 'replied',  label: 'Répondus' },
  { key: 'failed',   label: 'En échec' },
] as const;

export default function MessagesHistory({ campaignId }: { campaignId?: string }) {
  const [tab, setTab] = useState<string>('upcoming');
  const [messages, setMessages] = useState<Message[]>([]);
  const [upcoming, setUpcoming] = useState<Upcoming[]>([]);
  // Répartition des inscriptions : sert à expliquer une file vide.
  const [summary, setSummary] = useState<{ enrollments: Record<string, number>; stopReasons: Record<string, number> } | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [upcomingCount, setUpcomingCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Detail | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (campaignId) params.set('campaignId', campaignId);
      if (search) params.set('q', search);

      if (tab === 'upcoming') {
        const data = await fetch(`/api/campaigns/scheduled?${params}`).then(res => res.json());
        setUpcoming(data.items || []);
        setTotal(data.total || 0);
        setUpcomingCount(data.total || 0);
        setPages(data.pages || 1);
        setSummary(data.summary || null);
      } else {
        if (tab) params.set('status', tab);
        const data = await fetch(`/api/campaigns/messages?${params}`).then(res => res.json());
        setMessages(data.messages || []);
        setCounts(data.counts || {});
        setTotal(data.total || 0);
        setPages(data.pages || 1);
      }
    } finally {
      setLoading(false);
    }
  }, [campaignId, page, search, tab]);

  useEffect(() => { load(); }, [load]);

  // Le compteur « À venir » doit s'afficher même quand on regarde l'historique.
  useEffect(() => {
    const params = new URLSearchParams();
    if (campaignId) params.set('campaignId', campaignId);
    fetch(`/api/campaigns/scheduled?${params}`)
      .then(res => res.json())
      .then(data => setUpcomingCount(data.total || 0))
      .catch(() => { /* le compteur n'est pas vital */ });
  }, [campaignId, tab]);

  const openDetail = async (id: string) => {
    const data = await fetch(`/api/campaigns/messages/${id}`).then(res => res.json());
    if (!data.error) setDetail(data);
  };

  const countFor = (key: string) => {
    if (key === 'upcoming') return upcomingCount;
    if (key === '') return counts.sent ?? 0;
    return counts[key] ?? 0;
  };

  return (
    <div style={{ padding: '18px 24px', overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map(item => {
          const active = tab === item.key;
          return (
            <button key={item.key} onClick={() => { setTab(item.key); setPage(1); }} style={{
              padding: '4px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 12,
              fontWeight: active ? 700 : 500,
              border: `1px solid ${active ? '#4f46e5' : '#e2e8f0'}`,
              background: active ? '#eef2ff' : '#fff',
              color: active ? '#4338ca' : '#64748b',
            }}>
              {item.label} <span style={{ opacity: 0.7 }}>{countFor(item.key)}</span>
            </button>
          );
        })}
        <input style={{ ...inp, width: 240, marginLeft: 'auto' }} placeholder="Rechercher (email, nom, sujet…)"
          value={query} onChange={event => setQuery(event.target.value)} />
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: '#94a3b8' }}>Chargement…</div>
      ) : tab === 'upcoming' ? (
        <UpcomingTable items={upcoming} showCampaign={!campaignId} summary={summary} />
      ) : (
        <MessagesTable messages={messages} showCampaign={!campaignId} onOpen={openDetail} />
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <div style={{ fontSize: 12, color: '#64748b' }}>{total} email{total > 1 ? 's' : ''}</div>
        {pages > 1 && (
          <>
            <button style={{ ...btnDef, marginLeft: 'auto' }} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Précédent</button>
            <span style={{ fontSize: 12, color: '#64748b' }}>Page {page} / {pages}</span>
            <button style={btnDef} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Suivant</button>
          </>
        )}
      </div>

      {detail && <MessageDetail detail={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

// ─── Envois passés ────────────────────────────────────────────────────────

function MessagesTable({ messages, showCampaign, onOpen }: {
  messages: Message[]; showCampaign: boolean; onOpen: (id: string) => void;
}) {
  if (messages.length === 0) {
    return <Empty text="Aucun email envoyé pour l'instant." />;
  }
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: '#f8fafc', textAlign: 'left', color: '#64748b' }}>
            <th style={th}>Date et heure</th>
            <th style={th}>Destinataire</th>
            {showCampaign && <th style={th}>Campagne</th>}
            <th style={th}>Étape</th>
            <th style={th}>Sujet</th>
            <th style={th}>Expéditeur</th>
            <th style={th}>Statut</th>
          </tr>
        </thead>
        <tbody>
          {messages.map(message => (
            <tr key={message.id} onClick={() => onOpen(message.id)}
              style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer' }}>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatDateTime(message.sentAt)}</td>
              <td style={td}>
                <div style={{ fontWeight: 500 }}>
                  {[message.lead?.firstName, message.lead?.lastName].filter(Boolean).join(' ') || message.toAddress}
                </div>
                <div style={{ color: '#94a3b8', fontSize: 11.5 }}>
                  {message.toAddress}{message.lead?.company ? ` · ${message.lead.company}` : ''}
                </div>
              </td>
              {showCampaign && <td style={{ ...td, color: '#475569' }}>{message.campaign.name}</td>}
              <td style={td}>{message.stepPosition}</td>
              <td style={{ ...td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {message.subject || <span style={{ color: '#94a3b8' }}>(sans objet)</span>}
              </td>
              <td style={{ ...td, color: '#94a3b8', fontSize: 11.5 }}>{message.mailbox?.email || '—'}</td>
              <td style={td}><MessageBadge message={message} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Le statut le plus avancé l'emporte : répondu > ouvert > envoyé. */
function MessageBadge({ message }: { message: Message }) {
  if (message.status === 'failed') return <Badge label="Échec" color="#b91c1c" title={message.error || ''} />;
  if (message.repliedAt) return <Badge label="Répondu" color="#7c3aed" title={`Le ${formatDateTime(message.repliedAt)}`} />;
  if (message.openedAt) {
    return <Badge label="Ouvert" color="#0ea5e9"
      title={`Le ${formatDateTime(message.openedAt)}${message.openCount > 1 ? ` · ${message.openCount} ouvertures` : ''}`} />;
  }
  return <Badge label="Envoyé" color="#64748b" />;
}

// ─── Envois à venir ───────────────────────────────────────────────────────

function UpcomingTable({ items, showCampaign, summary }: {
  items: Upcoming[];
  showCampaign: boolean;
  summary: { enrollments: Record<string, number>; stopReasons: Record<string, number> } | null;
}) {
  if (items.length === 0) return <NothingScheduled summary={summary} />;
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: '#f8fafc', textAlign: 'left', color: '#64748b' }}>
            <th style={th}>Envoi prévu</th>
            <th style={th}>Destinataire</th>
            {showCampaign && <th style={th}>Campagne</th>}
            <th style={th}>Étape</th>
            <th style={th}>Sujet (modèle)</th>
            <th style={th}>Expéditeur</th>
            <th style={th}>État</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const campaignState = CAMPAIGN_STATUS[item.campaign.status];
            // Une échéance n'est tenue que si la campagne tourne ET que le lead
            // n'est pas en pause : le dire vaut mieux qu'afficher une date qui
            // n'arrivera jamais.
            const blocked = item.campaign.status !== 'running' || item.enrollmentStatus === 'paused';
            return (
              <tr key={item.id} style={{ borderTop: '1px solid #f1f5f9', opacity: blocked ? 0.65 : 1 }}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {formatDateTime(item.scheduledAt)}
                  {item.overdue && !blocked && (
                    <div style={{ fontSize: 10.5, color: '#d97706' }}>en attente du moteur</div>
                  )}
                </td>
                <td style={td}>
                  <div style={{ fontWeight: 500 }}>
                    {[item.lead.firstName, item.lead.lastName].filter(Boolean).join(' ') || item.lead.email}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 11.5 }}>
                    {item.lead.email}{item.lead.company ? ` · ${item.lead.company}` : ''}
                  </div>
                </td>
                {showCampaign && <td style={{ ...td, color: '#475569' }}>{item.campaign.name}</td>}
                <td style={td}>{item.stepPosition} / {item.stepCount}</td>
                <td style={{ ...td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.subjectTemplate || <span style={{ color: '#94a3b8' }}>(sujet vide)</span>}
                </td>
                <td style={{ ...td, color: '#94a3b8', fontSize: 11.5 }}>{item.mailbox?.email || '—'}</td>
                <td style={td}>
                  {item.enrollmentStatus === 'paused'
                    ? <Badge label="Lead en pause" color="#d97706" />
                    : item.campaign.status !== 'running'
                      ? <Badge label={`Campagne ${(campaignState?.label || item.campaign.status).toLowerCase()}`} color="#d97706" />
                      : <Badge label="Programmé" color="#16a34a" />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Contenu d'un email envoyé ────────────────────────────────────────────

function MessageDetail({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const { message, replies } = detail;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 24 }}
      onClick={onClose}>
      <div onClick={event => event.stopPropagation()} style={{ ...card, width: 'min(720px, 100%)', maxHeight: '88vh', overflow: 'auto' }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          {message.subject || '(sans objet)'}
        </div>
        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.7, marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #e2e8f0' }}>
          De : {message.fromAddress}<br />
          À : {message.lead?.email || message.toAddress}<br />
          Envoyé le {formatDateTime(message.sentAt)} · étape {message.stepPosition} · campagne « {message.campaign.name} »
          {message.openedAt && <><br />Ouvert le {formatDateTime(message.openedAt)}{message.openCount > 1 ? ` (${message.openCount} fois)` : ''}</>}
          {message.repliedAt && <><br />Réponse reçue le {formatDateTime(message.repliedAt)}</>}
          {message.error && <><br /><span style={{ color: '#b91c1c' }}>Échec : {message.error}</span></>}
        </div>

        {/* Le contenu réellement envoyé, variables déjà remplacées. */}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, background: '#fff' }}
          dangerouslySetInnerHTML={{ __html: message.bodyHtml }} />

        {replies.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '.6px', margin: '16px 0 7px' }}>
              RÉPONSES REÇUES DEPUIS
            </div>
            {replies.map(reply => (
              <div key={reply.id} style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '8px 11px', marginBottom: 6 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{reply.subject || '(sans objet)'}</div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>{reply.snippet.slice(0, 300)}</div>
                <div style={{ fontSize: 10.5, color: '#7c3aed', marginTop: 3 }}>
                  {reply.fromAddress} · {formatDateTime(reply.receivedAt)}
                </div>
              </div>
            ))}
          </>
        )}

        <button style={{ ...btnDef, marginTop: 14 }} onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}

// ─── Briques communes ─────────────────────────────────────────────────────

const th: React.CSSProperties = { padding: '9px 12px', fontWeight: 600, fontSize: 11.5 };
const td: React.CSSProperties = { padding: '9px 12px' };

function Badge({ label, color, title }: { label: string; color: string; title?: string }) {
  return (
    <span title={title} style={{
      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
      color, background: `${color}18`, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

/**
 * File vide : on explique POURQUOI plutôt que d'affirmer que tout est terminé.
 * Un lead arrêté à tort ou une campagne jamais lancée donnent le même écran
 * vide — et la différence est exactement ce qu'on cherche à cet instant.
 */
function NothingScheduled({ summary }: {
  summary: { enrollments: Record<string, number>; stopReasons: Record<string, number> } | null;
}) {
  const states = Object.entries(summary?.enrollments || {});
  const reasons = Object.entries(summary?.stopReasons || {});
  const totalLeads = states.reduce((sum, [, count]) => sum + count, 0);

  if (totalLeads === 0) {
    return <Empty text="Aucun lead inscrit : ajoutez-en dans l'onglet Leads de la campagne." />;
  }

  return (
    <div style={{ background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 12, padding: 24 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>Aucun envoi programmé</div>
      <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 14 }}>
        {totalLeads} lead{totalLeads > 1 ? 's' : ''} inscrit{totalLeads > 1 ? 's' : ''}, mais aucun n&apos;attend d&apos;envoi.
        Voici où ils en sont :
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {states.map(([status, count]) => {
          const state = ENROLLMENT_STATUS[status] || { label: status, color: '#64748b' };
          return (
            <div key={status} style={{ border: `1px solid ${state.color}33`, background: `${state.color}12`, borderRadius: 8, padding: '7px 12px' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: state.color }}>{count}</div>
              <div style={{ fontSize: 11, color: '#475569' }}>{state.label}</div>
            </div>
          );
        })}
      </div>

      {reasons.length > 0 && (
        <div style={{ fontSize: 12, color: '#475569' }}>
          Motifs d&apos;arrêt : {reasons.map(([reason, count]) => `${count} ${STOP_REASONS[reason] || reason}`).join(' · ')}.
          {reasons.some(([reason]) => reason === 'bounced') && (
            <div style={{ marginTop: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '9px 12px', color: '#78350f' }}>
              Des leads ont été arrêtés pour « adresse morte ». Si vos emails n&apos;ont jamais
              été remis, vérifiez d&apos;abord l&apos;état de vos boîtes d&apos;envoi : un refus
              d&apos;authentification ou un quota atteint vient de l&apos;expéditeur, pas de
              l&apos;adresse visée.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 12, padding: 28, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
      {text}
    </div>
  );
}

/** « 16 sept. 2026, 14:32 » — date ET heure, c'est tout l'intérêt de l'écran. */
function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
