'use client';
// src/components/campaigns/DashboardPanel.tsx
//
// Vue d'ensemble de l'outil Campagnes : ce qui est parti, ce qui a été ouvert,
// ce qui a répondu — toutes campagnes confondues — plus l'état de santé des
// boîtes d'envoi.
//
// Les boîtes sont en bonne place volontairement : un mot de passe expiré ou un
// quota atteint arrête les envois sans bruit, et c'est ici qu'on doit le voir.

import { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { LEAD_STATUSES, statusColor, statusLabel } from '@/lib/campaigns/leadFields';
import { CAMPAIGN_STATUS, btnXs, card } from './ui';

type Stats = {
  sent: number; contacted: number; opened: number; replied: number;
  bounced: number; failed: number; unsubscribed: number;
  openRate: number; replyRate: number; bounceRate: number;
  campaigns: { total: number; running: number };
  leads: Record<string, number>;
  mailboxes: Array<{ id: string; email: string; sentToday: number; sentTotal: number; active: boolean; lastError: string | null }>;
  daily: Array<{ date: string; sent: number; opened: number; replied: number }>;
  topCampaigns: Array<{ id: string; name: string; status: string; sent: number; openRate: number; replyRate: number }>;
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
  const totalLeads = Object.values(stats.leads).reduce((sum, count) => sum + count, 0);

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

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, marginBottom: 18 }}>
        <div style={card}>
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
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
            Leads <span style={{ fontWeight: 400, color: '#6b7283' }}>({totalLeads})</span>
          </div>
          {LEAD_STATUSES.filter(status => stats.leads[status.key]).map(status => {
            const count = stats.leads[status.key] || 0;
            return (
              <div key={status.key} style={{ marginBottom: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: statusColor(status.key) }}>{statusLabel(status.key)}</span>
                  <strong>{count}</strong>
                </div>
                <div style={{ height: 5, borderRadius: 3, background: '#222634', overflow: 'hidden' }}>
                  <div style={{ width: `${(count / Math.max(1, totalLeads)) * 100}%`, height: '100%', background: statusColor(status.key) }} />
                </div>
              </div>
            );
          })}
          {totalLeads === 0 && <div style={{ fontSize: 12.5, color: '#6b7283' }}>Aucun lead importé.</div>}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Campagnes</div>
          <button style={{ ...btnXs, marginLeft: 'auto' }} onClick={onOpenCampaigns}>Voir toutes</button>
        </div>
        {stats.topCampaigns.length === 0 ? (
          <div style={{ fontSize: 12.5, color: '#6b7283' }}>Aucune campagne créée.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#9aa1b4' }}>
                <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11.5 }}>Campagne</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11.5 }}>Envoyés</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11.5 }}>Ouverture</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11.5 }}>Réponse</th>
              </tr>
            </thead>
            <tbody>
              {stats.topCampaigns.map(campaign => {
                const state = CAMPAIGN_STATUS[campaign.status] || { label: campaign.status, color: '#9aa1b4' };
                return (
                  <tr key={campaign.id} style={{ borderTop: '1px solid #222634' }}>
                    <td style={{ padding: '8px' }}>
                      {campaign.name}
                      <span style={{ marginLeft: 8, padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 600, color: state.color, background: `${state.color}18` }}>
                        {state.label}
                      </span>
                    </td>
                    <td style={{ padding: '8px' }}>{campaign.sent}</td>
                    <td style={{ padding: '8px' }}>{campaign.openRate} %</td>
                    <td style={{ padding: '8px', fontWeight: 600 }}>{campaign.replyRate} %</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
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
