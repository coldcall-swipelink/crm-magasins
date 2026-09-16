'use client';
// src/components/campaigns/CampaignStatsTab.tsx
//
// Tableau de bord d'une campagne : l'entonnoir (envoyés → ouverts → réponses),
// l'état des inscriptions, et le détail étape par étape — c'est ce dernier qui
// dit quelle relance travaille vraiment.

import { STOP_REASONS, card } from './ui';

export type Stats = {
  sent: number; contacted: number; opened: number; openedLeads: number;
  replied: number; bounced: number; failed: number; unsubscribed: number;
  openRate: number; replyRate: number; bounceRate: number;
  enrollments: Record<string, number>;
  stopReasons: Record<string, number>;
  pending: number;
  steps: Array<{ stepId: string; position: number; subject: string; sent: number; opened: number; replied: number; openRate: number; replyRate: number }>;
};

export default function CampaignStatsTab({ stats, trackOpens }: { stats: Stats; trackOpens: boolean }) {
  return (
    <div style={{ padding: '18px 24px', maxWidth: 940 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Metric label="Emails envoyés" value={stats.sent} />
        <Metric label="Leads contactés" value={stats.contacted} />
        <Metric label="Taux d'ouverture" value={trackOpens ? `${stats.openRate} %` : '—'}
          hint={trackOpens ? `${stats.opened} ouverture(s)` : 'suivi désactivé'} accent />
        <Metric label="Taux de réponse" value={`${stats.replyRate} %`} hint={`${stats.replied} lead(s)`} accent />
        <Metric label="Adresses mortes" value={stats.bounced} hint={`${stats.bounceRate} %`}
          warn={stats.bounceRate > 5} />
        <Metric label="Désinscriptions" value={stats.unsubscribed} />
      </div>

      {stats.bounceRate > 5 && stats.contacted > 20 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: '#b91c1c', marginBottom: 18 }}>
          Plus de 5 % d&apos;adresses mortes : au-delà, la réputation des domaines d&apos;envoi se dégrade vite.
          Nettoyez le fichier avant d&apos;inscrire d&apos;autres leads.
        </div>
      )}

      <div style={{ ...card, marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Étape par étape</div>
        {stats.steps.length === 0 ? (
          <div style={{ fontSize: 12.5, color: '#94a3b8' }}>Aucune étape.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748b' }}>
                <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11.5 }}>Étape</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11.5 }}>Envoyés</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11.5 }}>Ouverts</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11.5 }}>Réponses</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11.5, width: 180 }}></th>
              </tr>
            </thead>
            <tbody>
              {stats.steps.map(step => (
                <tr key={step.stepId} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px' }}>
                    <div style={{ fontWeight: 600 }}>Étape {step.position}</div>
                    <div style={{ color: '#94a3b8', fontSize: 11.5, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {step.subject || '(sujet vide)'}
                    </div>
                  </td>
                  <td style={{ padding: '8px' }}>{step.sent}</td>
                  <td style={{ padding: '8px' }}>{trackOpens ? `${step.opened} (${step.openRate} %)` : '—'}</td>
                  <td style={{ padding: '8px' }}>{step.replied} ({step.replyRate} %)</td>
                  <td style={{ padding: '8px' }}>
                    {/* Barre de comparaison entre étapes : la plus envoyée fait référence. */}
                    <div style={{ height: 6, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.min(100, (step.sent / Math.max(1, Math.max(...stats.steps.map(s => s.sent)))) * 100)}%`,
                        height: '100%', background: '#6366f1',
                      }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Où en sont les leads</div>
          {Object.keys(stats.enrollments).length === 0 && <div style={{ fontSize: 12.5, color: '#94a3b8' }}>Aucun lead inscrit.</div>}
          {Object.entries(stats.enrollments).map(([key, count]) => (
            <Row key={key} label={key} value={count} />
          ))}
          {stats.pending > 0 && (
            <div style={{ fontSize: 11.5, color: '#4338ca', marginTop: 8 }}>
              {stats.pending} envoi(s) dû(s) : ils partiront au prochain passage du moteur.
            </div>
          )}
        </div>
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Pourquoi les séquences se sont arrêtées</div>
          {Object.keys(stats.stopReasons).length === 0 && <div style={{ fontSize: 12.5, color: '#94a3b8' }}>Aucun arrêt pour l&apos;instant.</div>}
          {Object.entries(stats.stopReasons).map(([key, count]) => (
            <Row key={key} label={STOP_REASONS[key] || key} value={count} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, hint, accent, warn }: {
  label: string; value: number | string; hint?: string; accent?: boolean; warn?: boolean;
}) {
  return (
    <div style={{
      background: warn ? '#fef2f2' : accent ? '#eef2ff' : '#fff',
      border: `1px solid ${warn ? '#fecaca' : accent ? '#c7d2fe' : '#e2e8f0'}`,
      borderRadius: 10, padding: '14px 16px',
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: warn ? '#b91c1c' : accent ? '#4338ca' : '#0f172a' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>{label}</div>
      {hint && <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 1 }}>{hint}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid #f8fafc' }}>
      <span style={{ color: '#475569' }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
