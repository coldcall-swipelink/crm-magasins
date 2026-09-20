'use client';
// src/components/campaigns/CampaignStatsTab.tsx
//
// Tableau de bord d'une campagne : l'entonnoir (envoyés → ouverts → réponses),
// l'état des inscriptions, et le détail étape par étape — c'est ce dernier qui
// dit quelle relance travaille vraiment.
//
// Tests A/B : chaque étape testée a sa carte de comparaison, variante par
// variante. La « meilleure » est celle qui a le meilleur taux de réponse — la
// seule mesure commerciale — et on ne la désigne qu'à partir d'un volume
// minimal par variante : sur dix envois, un écart de réponse n'est que du
// hasard.

import { STOP_REASONS, T, card } from './ui';

export type VariantStats = {
  key: string; subject: string;
  sent: number; opened: number; replied: number; openRate: number; replyRate: number;
  state: 'running' | 'paused' | 'kept' | 'dropped';
};

export type StepStats = {
  stepId: string; position: number; subject: string;
  sent: number; opened: number; replied: number; openRate: number; replyRate: number;
  testing: boolean;
  variants: VariantStats[];
};

export type Stats = {
  sent: number; contacted: number; opened: number; openedLeads: number;
  replied: number; bounced: number; failed: number; unsubscribed: number;
  openRate: number; replyRate: number; bounceRate: number;
  enrollments: Record<string, number>;
  stopReasons: Record<string, number>;
  pending: number;
  steps: StepStats[];
};

/** En dessous, on ne désigne pas de gagnante : l'écart n'est pas significatif. */
const MIN_SENT_TO_COMPARE = 30;

const VARIANT_STATE: Record<VariantStats['state'], { label: string; color: string }> = {
  running: { label: 'en cours', color: '#4ade80' },
  paused:  { label: 'en pause', color: T.warnText },
  kept:    { label: 'gardée',   color: T.primaryText },
  dropped: { label: 'retirée',  color: T.textFaint },
};

/**
 * La variante en tête sur le taux de réponse, si le test a assez de volume.
 * À réponses égales, c'est l'ouverture qui départage ; à zéro réponse
 * partout, personne n'est en tête.
 */
function leader(variants: VariantStats[]): string | null {
  const eligible = variants.filter(variant => variant.sent >= MIN_SENT_TO_COMPARE);
  if (eligible.length < 2) return null;
  const sorted = [...eligible].sort((a, b) => b.replyRate - a.replyRate || b.openRate - a.openRate);
  if (sorted[0].replied === 0) return null;
  if (sorted[0].replyRate === sorted[1].replyRate && sorted[0].openRate === sorted[1].openRate) return null;
  return sorted[0].key;
}

export default function CampaignStatsTab({ stats, trackOpens }: { stats: Stats; trackOpens: boolean }) {
  const tested = stats.steps.filter(step => step.variants.length > 0);

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
        <div style={{ background: 'rgba(239,68,68,.13)', border: '1px solid rgba(239,68,68,.35)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: '#f87171', marginBottom: 18 }}>
          Plus de 5 % d&apos;adresses mortes : au-delà, la réputation des domaines d&apos;envoi se dégrade vite.
          Nettoyez le fichier avant d&apos;inscrire d&apos;autres leads.
        </div>
      )}

      {tested.length > 0 && (
        <div style={{ ...card, marginBottom: 18, borderColor: `${T.violet}55` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Tests A/B</div>
            <div style={{ fontSize: 11.5, color: T.textFaint }}>
              {tested.length} étape{tested.length > 1 ? 's' : ''} testée{tested.length > 1 ? 's' : ''}
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: T.textFaint, marginBottom: 12 }}>
            Taux calculés sur les emails de chaque variante. La variante en tête n&apos;est désignée
            qu&apos;à partir de {MIN_SENT_TO_COMPARE} envois par variante : en dessous, l&apos;écart peut n&apos;être que du hasard.
          </div>
          <div style={{ display: 'grid', gap: 14 }}>
            {tested.map(step => <VariantComparison key={step.stepId} step={step} trackOpens={trackOpens} />)}
          </div>
        </div>
      )}

      <div style={{ ...card, marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Étape par étape</div>
        {stats.steps.length === 0 ? (
          <div style={{ fontSize: 12.5, color: '#6b7283' }}>Aucune étape.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#9aa1b4' }}>
                <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11.5 }}>Étape</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11.5 }}>Envoyés</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11.5 }}>Ouverts</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11.5 }}>Réponses</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11.5, width: 180 }}></th>
              </tr>
            </thead>
            <tbody>
              {stats.steps.map(step => (
                <tr key={step.stepId} style={{ borderTop: '1px solid #222634' }}>
                  <td style={{ padding: '8px' }}>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      Étape {step.position}
                      {step.testing && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: T.violetText, background: T.violetSoft, borderRadius: 999, padding: '0 7px' }}>
                          A/B
                        </span>
                      )}
                    </div>
                    <div style={{ color: '#6b7283', fontSize: 11.5, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {step.testing
                        ? step.variants.filter(v => v.state === 'running' || v.state === 'paused').map(v => `${v.key} · ${v.subject || '(sujet vide)'}`).join('  /  ')
                        : (step.subject || '(sujet vide)')}
                    </div>
                  </td>
                  <td style={{ padding: '8px' }}>{step.sent}</td>
                  <td style={{ padding: '8px' }}>{trackOpens ? `${step.opened} (${step.openRate} %)` : '—'}</td>
                  <td style={{ padding: '8px' }}>{step.replied} ({step.replyRate} %)</td>
                  <td style={{ padding: '8px' }}>
                    {/* Barre de comparaison entre étapes : la plus envoyée fait référence. */}
                    <div style={{ height: 6, borderRadius: 3, background: '#222634', overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.min(100, (step.sent / Math.max(1, Math.max(...stats.steps.map(s => s.sent)))) * 100)}%`,
                        height: '100%', background: '#3b71f5',
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
          {Object.keys(stats.enrollments).length === 0 && <div style={{ fontSize: 12.5, color: '#6b7283' }}>Aucun lead inscrit.</div>}
          {Object.entries(stats.enrollments).map(([key, count]) => (
            <Row key={key} label={key} value={count} />
          ))}
          {stats.pending > 0 && (
            <div style={{ fontSize: 11.5, color: '#8fb0ff', marginTop: 8 }}>
              {stats.pending} envoi(s) dû(s) : ils partiront au prochain passage du moteur.
            </div>
          )}
        </div>
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Pourquoi les séquences se sont arrêtées</div>
          {Object.keys(stats.stopReasons).length === 0 && <div style={{ fontSize: 12.5, color: '#6b7283' }}>Aucun arrêt pour l&apos;instant.</div>}
          {Object.entries(stats.stopReasons).map(([key, count]) => (
            <Row key={key} label={STOP_REASONS[key] || key} value={count} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** La comparaison des variantes d'une étape : une ligne par lettre, deux barres. */
function VariantComparison({ step, trackOpens }: { step: StepStats; trackOpens: boolean }) {
  const best = leader(step.variants);
  const closed = !step.testing;
  const maxOpen = Math.max(1, ...step.variants.map(variant => variant.openRate));
  const maxReply = Math.max(1, ...step.variants.map(variant => variant.replyRate));
  const thin = step.variants.some(variant => variant.sent < MIN_SENT_TO_COMPARE);

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px', background: T.surfaceAlt }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>Étape {step.position}</div>
        <div style={{ fontSize: 11.5, color: T.textFaint }}>
          {closed ? 'test clos' : `${step.variants.filter(v => v.state === 'running').length} variante(s) en cours`}
          {' · '}{step.sent} envoi{step.sent > 1 ? 's' : ''}
        </div>
        {best && (
          <div style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 600, color: '#4ade80' }}>
            ★ La variante {best} est en tête
          </div>
        )}
        {!best && thin && !closed && (
          <div style={{ marginLeft: 'auto', fontSize: 11.5, color: T.textFaint }}>
            Pas encore assez d&apos;envois pour départager
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {step.variants.map(variant => {
          const state = VARIANT_STATE[variant.state];
          const isBest = variant.key === best;
          return (
            <div key={variant.key} className="camp-ab-row" style={{
              display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr) 70px 150px 150px', gap: 10, alignItems: 'center',
              padding: '8px 10px', borderRadius: 8,
              background: isBest ? T.successSoft : T.surface,
              border: `1px solid ${isBest ? `${T.success}55` : T.border}`,
              opacity: variant.state === 'dropped' || variant.state === 'paused' ? 0.75 : 1,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12.5, fontWeight: 800, color: '#fff', background: isBest ? T.success : T.violet,
              }}>{variant.key}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: variant.subject ? T.text : T.textFaint, fontStyle: variant.subject ? 'normal' : 'italic' }}>
                  {variant.subject || (variant.state === 'dropped' ? 'texte supprimé' : '(sujet vide)')}
                </div>
                <div style={{ fontSize: 11, color: state.color, marginTop: 2 }}>{state.label}</div>
              </div>
              <div style={{ fontSize: 12.5, textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>{variant.sent}</div>
                <div style={{ fontSize: 10.5, color: T.textFaint }}>envoyés</div>
              </div>
              <Bar label="ouverture" value={trackOpens ? variant.openRate : null} count={variant.opened} max={maxOpen} color="#0ea5e9" />
              <Bar label="réponse" value={variant.replyRate} count={variant.replied} max={maxReply} color={isBest ? T.success : T.violet} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Un taux, sa barre et son effectif ; null = suivi désactivé. */
function Bar({ label, value, count, max, color }: { label: string; value: number | null; count: number; max: number; color: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
        <span style={{ color: T.textFaint }}>{label}</span>
        <span style={{ fontWeight: 600, color: value === null ? T.textFaint : T.text }}>
          {value === null ? '—' : `${value} %`}<span style={{ color: T.textFaint, fontWeight: 400 }}> · {count}</span>
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: '#222634', overflow: 'hidden' }}>
        <div style={{ width: `${value === null ? 0 : Math.min(100, (value / max) * 100)}%`, height: '100%', background: color }} />
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

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid #1c1f2a' }}>
      <span style={{ color: '#b3b9c9' }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
