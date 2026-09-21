'use client';
// src/components/campaigns/DashboardPanel.tsx
//
// Vue d'ensemble de l'outil Campagnes : ce qui est parti, ce qui a été ouvert,
// ce qui a répondu — toutes campagnes confondues, puis campagne par campagne —
// plus l'état de santé des boîtes d'envoi.
//
// Les boîtes sont en bonne place volontairement : un mot de passe expiré ou un
// quota atteint arrête les envois sans bruit, et c'est ici qu'on doit le voir.

import { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import type { CampaignRow } from '@/lib/campaigns/stats';
import { toast } from '@/components/ui/Toast';
import { CAMPAIGN_STATUS, T, btnDef, btnXs, card } from './ui';

type Stats = {
  sent: number; contacted: number; opened: number; replied: number;
  bounced: number; failed: number; unsubscribed: number;
  openRate: number; replyRate: number; bounceRate: number;
  campaigns: { total: number; running: number };
  mailboxes: Array<{ id: string; email: string; sentToday: number; sentTotal: number; active: boolean; lastError: string | null }>;
  daily: Array<{ date: string; sent: number; opened: number; replied: number }>;
  campaignRows: CampaignRow[];
  lastRun: string | null;
};

const RANGES = [7, 30, 90];

export default function DashboardPanel({ onOpenCampaigns }: { onOpenCampaigns: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns/stats?days=${days}`);
      const data = await res.json();
      setStats(data.stats);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  if (loading && !stats) {
    return <div style={{ padding: 24, fontSize: 13, color: '#6b7283' }}>Chargement…</div>;
  }
  if (!stats) return null;

  const series = stats.daily.map(point => ({
    ...point,
    label: new Date(point.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
  }));

  return (
    <div style={{ padding: '18px 24px', maxWidth: 1100, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Vue d&apos;ensemble</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
          {RANGES.map(range => (
            <button key={range} onClick={() => setDays(range)} style={{
              ...btnXs,
              borderColor: days === range ? '#3b71f5' : '#262b38',
              background: days === range ? 'rgba(59,113,245,.16)' : '#1c1f2a',
              color: days === range ? '#8fb0ff' : '#9aa1b4',
            }}>{range} jours</button>
          ))}
        </div>
      </div>

      <EngineHeartbeat lastRun={stats.lastRun} />
      <ReplySync onDone={load} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Metric label="Emails envoyés" value={stats.sent} hint="depuis le début" />
        <Metric label="Leads contactés" value={stats.contacted} />
        <Metric label="Taux d'ouverture" value={`${stats.openRate} %`} hint={`${stats.opened} ouverture(s)`} accent />
        <Metric label="Taux de réponse" value={`${stats.replyRate} %`} hint={`${stats.replied} lead(s)`} accent />
        <Metric label="Adresses mortes" value={stats.bounced} hint={`${stats.bounceRate} %`} warn={stats.bounceRate > 5} />
        <Metric label="Campagnes actives" value={stats.campaigns.running} hint={`${stats.campaigns.total} au total`} />
      </div>

      <div style={{ ...card, marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Activité sur {days} jours</div>
        {stats.sent === 0 ? (
          <div style={{ fontSize: 12.5, color: '#6b7283', padding: '30px 0', textAlign: 'center' }}>
            Aucun email envoyé pour l&apos;instant.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#262b38" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7283' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#6b7283' }} width={34} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #262b38' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="sent" name="Envoyés" fill="#3b71f5" radius={[3, 3, 0, 0]} maxBarSize={26} />
              <Line type="monotone" dataKey="opened" name="Ouverts" stroke="#0ea5e9" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="replied" name="Réponses" stroke="#16a34a" strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={{ ...card, marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Boîtes d&apos;envoi</div>
        {stats.mailboxes.length === 0 ? (
          <div style={{ fontSize: 12.5, color: '#6b7283' }}>Aucune boîte connectée.</div>
        ) : stats.mailboxes.map(mailbox => (
          <div key={mailbox.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #1c1f2a' }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: mailbox.lastError ? '#f87171' : mailbox.active ? '#4ade80' : '#333a4a',
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500 }}>{mailbox.email}</div>
              {mailbox.lastError && (
                <div style={{ fontSize: 11, color: '#f87171', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {mailbox.lastError}
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{mailbox.sentToday}</div>
              <div style={{ fontSize: 10, color: '#6b7283' }}>aujourd&apos;hui</div>
            </div>
            <div style={{ textAlign: 'right', minWidth: 54 }}>
              <div style={{ fontSize: 12.5, color: '#b3b9c9' }}>{mailbox.sentTotal}</div>
              <div style={{ fontSize: 10, color: '#6b7283' }}>au total</div>
            </div>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Campagne par campagne</div>
          <button style={{ ...btnXs, marginLeft: 'auto' }} onClick={onOpenCampaigns}>Voir toutes</button>
        </div>
        {stats.campaignRows.length === 0 ? (
          <div style={{ fontSize: 12.5, color: '#6b7283' }}>Aucune campagne créée.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#9aa1b4' }}>
                <th style={th}>Campagne</th>
                <th style={{ ...th, textAlign: 'right' }}>Contactés</th>
                <th style={{ ...th, minWidth: 150 }}>Progression</th>
                <th style={{ ...th, textAlign: 'right' }}>Séquence complète</th>
                <th style={{ ...th, textAlign: 'right' }}>Ouverture</th>
                <th style={{ ...th, textAlign: 'right' }}>Réponse</th>
              </tr>
            </thead>
            <tbody>
              {stats.campaignRows.map(campaign => (
                <CampaignTableRow key={campaign.id} campaign={campaign} />
              ))}
            </tbody>
          </table>
        )}
        <div style={{ fontSize: 11, color: '#6b7283', marginTop: 10, lineHeight: 1.6 }}>
          Progression : part des envois prévus déjà partis — une séquence arrêtée (réponse,
          désinscription, adresse morte) compte comme terminée puisqu&apos;elle n&apos;a plus rien à envoyer.
          Séquence complète : leads qui ont reçu toutes les étapes sans répondre.
        </div>
      </div>

      <div style={{ fontSize: 11, color: '#6b7283', marginTop: 14, lineHeight: 1.6 }}>
        Le taux d&apos;ouverture repose sur un pixel invisible : une image bloquée ne compte pas
        l&apos;ouverture, un pré-chargement (Apple Mail, proxy Gmail) la compte à tort. Il se lit
        comme une tendance. Le taux de réponse, lui, est mesuré sur les réponses réellement
        reçues dans les boîtes — c&apos;est le seul chiffre solide.
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, fontSize: 11.5, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '8px', verticalAlign: 'middle' };
const num: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

/** Une ligne du tableau campagne par campagne. */
function CampaignTableRow({ campaign }: { campaign: CampaignRow }) {
  const state = CAMPAIGN_STATUS[campaign.status] || { label: campaign.status, color: '#9aa1b4' };
  const done = campaign.progress >= 100;
  return (
    <tr style={{ borderTop: '1px solid #222634' }}>
      <td style={td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{campaign.name}</span>
          <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 600, color: state.color, background: `${state.color}18`, whiteSpace: 'nowrap' }}>
            {state.label}
          </span>
        </div>
        <div style={{ fontSize: 10.5, color: '#6b7283', marginTop: 2 }}>
          {campaign.enrolled} inscrit{campaign.enrolled > 1 ? 's' : ''} · {campaign.steps} étape{campaign.steps > 1 ? 's' : ''} · {campaign.sent} email{campaign.sent > 1 ? 's' : ''}
        </div>
      </td>
      <td style={{ ...num, fontWeight: 600 }}>{campaign.contacted}</td>
      <td style={td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#222634', overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, campaign.progress)}%`, height: '100%', background: done ? T.success : T.primary }} />
          </div>
          <span style={{ fontSize: 11.5, minWidth: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: done ? '#4ade80' : '#b3b9c9' }}>
            {campaign.progress} %
          </span>
        </div>
      </td>
      <td style={num}>
        {campaign.completed}
        <span style={{ color: '#6b7283', fontSize: 11 }}> / {campaign.enrolled}</span>
      </td>
      <td style={num}>
        {campaign.openRate} %
        <span style={{ color: '#6b7283', fontSize: 11 }}> · {campaign.opened}</span>
      </td>
      <td style={{ ...num, fontWeight: 600 }}>
        {campaign.replyRate} %
        <span style={{ color: '#6b7283', fontSize: 11, fontWeight: 400 }}> · {campaign.replied}</span>
      </td>
    </tr>
  );
}

/**
 * Battement de cœur du moteur d'envoi.
 *
 * Le verrou le plus difficile à voir : tout peut être correctement réglé et
 * n'avoir jamais été relevé, parce que la tâche planifiée ne tourne pas. Sans
 * cette ligne, la file n'avance pas et rien ne dit pourquoi.
 */
function EngineHeartbeat({ lastRun }: { lastRun: string | null }) {
  if (lastRun) {
    const minutes = Math.round((Date.now() - new Date(lastRun).getTime()) / 60_000);
    // Il tourne toutes les 5 minutes : au-delà de 20, quelque chose cloche.
    if (minutes <= 20) {
      return (
        <div style={{ fontSize: 11.5, color: '#6b7283', marginBottom: 12 }}>
          Planificateur : dernier passage automatique il y a {minutes} minute{minutes > 1 ? 's' : ''}.
        </div>
      );
    }
    return (
      <div style={{ background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.35)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: '#fbbf24', marginBottom: 14 }}>
        <strong>Le planificateur n&apos;a pas tourné depuis {minutes} minutes</strong> — il devrait
        passer toutes les 5 minutes. Tant qu&apos;il dort, les relances des campagnes attendent.
      </div>
    );
  }

  return (
    <div style={{ background: 'rgba(239,68,68,.13)', border: '1px solid rgba(239,68,68,.35)', borderRadius: 8, padding: '12px 14px', fontSize: 12.5, color: '#f87171', marginBottom: 14 }}>
      <strong>Le planificateur n&apos;a jamais tourné.</strong>
      <div style={{ marginTop: 4, color: '#fca5a5' }}>
        La tâche planifiée <code>/api/campaigns/run</code> n&apos;est pas déclenchée — les
        <strong> relances des étapes suivantes ne partiront donc pas toutes seules</strong>.
        Sur un hébergement qui limite les tâches planifiées à une par jour, appelez cette route
        depuis un planificateur externe (N8N…) toutes les 5 minutes. Les envois déclenchés depuis
        l&apos;interface, eux, ne dépendent pas d&apos;elle.
      </div>
    </div>
  );
}

/**
 * Relève manuelle des réponses.
 *
 * Le planificateur relève les boîtes tout seul, mais il ne revient jamais en
 * arrière : il ne lit que ce qui est arrivé depuis son dernier passage. Deux
 * besoins en découlent — forcer un passage sans attendre, et RELIRE une
 * période écoulée quand une correction du rattachement doit s'appliquer à ce
 * qui a déjà été reçu.
 */
function ReplySync({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState<'now' | 'catchup' | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const run = async (mode: 'now' | 'catchup') => {
    setBusy(mode);
    setResult(null);
    try {
      const res = await fetch('/api/campaigns/sync-replies/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'catchup' ? { sinceDays: 30 } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Relève impossible', 'error'); return; }

      const t = data.total || {};
      setResult(
        `${t.scanned ?? 0} message(s) lu(s) · ${t.replies ?? 0} réponse(s) · `
        + `${t.bounces ?? 0} rejet(s) · ${t.stopped ?? 0} séquence(s) arrêtée(s)`
        + (t.unmatched ? ` · ${t.unmatched} non rattaché(s)` : ''),
      );
      const failed = (data.reports || []).filter((report: { error?: string }) => report.error);
      if (failed.length > 0) {
        toast(`${failed.length} boîte(s) en échec : ${failed[0].error}`, 'error');
      }
      onDone();
    } catch (err) {
      toast(`Relève impossible : ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ ...card, padding: '12px 14px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>Réponses reçues</div>
        <div style={{ fontSize: 11.5, color: T.textFaint, flex: 1, minWidth: 220 }}>
          Le planificateur relève les boîtes tout seul. Ces boutons forcent un passage.
        </div>
        <button style={{ ...btnXs, opacity: busy ? 0.6 : 1 }} disabled={busy !== null}
          onClick={() => run('now')}>
          {busy === 'now' ? 'Relève…' : 'Relever maintenant'}
        </button>
        <button style={{ ...btnDef, padding: '6px 12px', fontSize: 12, opacity: busy ? 0.6 : 1 }}
          disabled={busy !== null}
          title="Relit tout ce qui est arrivé depuis 30 jours, pour rattacher ce qu'un passage précédent n'avait pas su rattacher"
          onClick={() => run('catchup')}>
          {busy === 'catchup' ? 'Rattrapage…' : 'Rattraper 30 jours'}
        </button>
      </div>
      {busy && (
        <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 8 }}>
          Lecture des boîtes en cours — cela peut prendre une à deux minutes.
        </div>
      )}
      {result && !busy && (
        <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 8 }}>{result}</div>
      )}
    </div>
  );
}

function Metric({ label, value, hint, accent, warn }: {
  label: string; value: number | string; hint?: string; accent?: boolean; warn?: boolean;
}) {
  return (
    <div style={{
      background: warn ? 'rgba(239,68,68,.13)' : accent ? 'rgba(59,113,245,.16)' : '#171a23',
      border: `1px solid ${warn ? 'rgba(239,68,68,.35)' : accent ? 'rgba(59,113,245,.38)' : '#262b38'}`,
      borderRadius: 10, padding: '14px 16px',
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: warn ? '#f87171' : accent ? '#8fb0ff' : '#e7e9ef' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: '#9aa1b4', marginTop: 2 }}>{label}</div>
      {hint && <div style={{ fontSize: 10.5, color: '#6b7283', marginTop: 1 }}>{hint}</div>}
    </div>
  );
}
