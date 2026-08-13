'use client';
// Bloc « Appels » du Dashboard. Un appel = un clic sur « Afficher le numéro »
// dans la fiche affaire. Affiche le volume d'appels sur la période choisie
// (1 semaine, 2 semaines, 1 mois, 3 mois, 1 an, tout), la comparaison avec la
// période précédente, le classement par utilisateur et la courbe journalière.
import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

interface CallUserStat {
  userId: string | null;
  name: string;
  color: string;
  count: number;
  previousCount: number;
}
interface CallStatsData {
  days: number;
  from: string | null;
  to: string;
  total: number;
  previousTotal: number;
  byUser: CallUserStat[];
  series: { date: string; count: number }[];
  totals: { d7: number; d14: number; d30: number; d90: number; all: number };
}

const PERIODS: { days: number; label: string }[] = [
  { days: 7,   label: '1 semaine' },
  { days: 14,  label: '2 semaines' },
  { days: 30,  label: '1 mois' },
  { days: 90,  label: '3 mois' },
  { days: 365, label: '1 an' },
  { days: 0,   label: 'Tout' },
];

/** Variation en % entre la période courante et la précédente (null = pas de base). */
function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return cur ? null : 0;
  return ((cur - prev) / prev) * 100;
}

/** « 2026-08-13 » → « 13/08 » pour l'axe du graphe. */
function shortDay(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export default function CallStats() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<CallStatsData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    fetch(`/api/calls/stats?days=${days}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [days]);

  const periodLabel = PERIODS.find(p => p.days === days)?.label ?? '';
  const delta = data ? pctDelta(data.total, data.previousTotal) : null;
  const maxUser = useMemo(() => Math.max(1, ...(data?.byUser ?? []).map(u => u.count)), [data]);
  // Le graphe journalier reste lisible jusqu'à ~90 points ; au-delà on le masque
  // (le classement par utilisateur porte alors l'information utile).
  const showSeries = !!data && data.series.length > 0 && data.series.length <= 120;

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>📞 Appels passés</div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>
          un appel = un clic sur « Afficher le numéro » dans une fiche affaire
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PERIODS.map(p => (
            <button key={p.days} onClick={() => setDays(p.days)} style={pill(days === p.days)}>{p.label}</button>
          ))}
        </div>
      </div>

      {error && <div style={empty}>Statistiques d&apos;appels indisponibles</div>}
      {!error && !data && <div style={empty}>Chargement…</div>}

      {!error && data && (
        <>
          {/* Totaux : période sélectionnée + repères fixes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}>
            <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 5 }}>Appels · {periodLabel.toLowerCase()}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 25, fontWeight: 800, color: '#4338ca', lineHeight: 1 }}>{data.total}</div>
                {days > 0 && delta !== null && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                    color: delta >= 0 ? '#15803d' : '#dc2626', background: delta >= 0 ? '#dcfce7' : '#fee2e2',
                  }}>
                    {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)} %
                  </span>
                )}
              </div>
              {days > 0 && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>période préc. : {data.previousTotal}</div>}
            </div>
            <Tile label="7 derniers jours" value={data.totals.d7} />
            <Tile label="14 derniers jours" value={data.totals.d14} />
            <Tile label="30 derniers jours" value={data.totals.d30} />
            <Tile label="Depuis le début" value={data.totals.all} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: showSeries ? '1fr 1fr' : '1fr', gap: 16 }}>
            {/* Classement par utilisateur */}
            <div>
              <div style={subTitle}>Appels par utilisateur</div>
              {data.byUser.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.byUser.map(u => (
                    <div key={u.userId ?? u.name}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginBottom: 3 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: u.color, flexShrink: 0 }} />
                        <span style={{ color: '#334155', fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
                        <span style={{ color: '#0f172a', fontWeight: 800 }}>{u.count}</span>
                        {days > 0 && (
                          <span style={{ fontSize: 11, color: '#94a3b8', width: 58, textAlign: 'right' }}>
                            préc. {u.previousCount}
                          </span>
                        )}
                      </div>
                      <div style={{ height: 6, background: '#f1f5f9', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{ width: `${(u.count / maxUser) * 100}%`, height: '100%', background: u.color, borderRadius: 999 }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div style={empty}>Aucun appel sur cette période</div>}
            </div>

            {/* Volume journalier */}
            {showSeries && (
              <div>
                <div style={subTitle}>Volume journalier</div>
                {data.total ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={data.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
                      <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={28} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                        labelFormatter={(v: any) => shortDay(String(v))}
                        formatter={((value: any) => [value, 'Appels']) as any}
                      />
                      <Bar dataKey="count" fill="#4f46e5" radius={[3, 3, 0, 0]} maxBarSize={26} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <div style={empty}>Aucun appel sur cette période</div>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>{value}</div>
    </div>
  );
}

const card: React.CSSProperties = { background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 16 };
const subTitle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 10 };
const empty: React.CSSProperties = { height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 };
function pill(active: boolean): React.CSSProperties {
  return {
    height: 30, padding: '0 11px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
    border: `1px solid ${active ? '#6366f1' : '#e2e8f0'}`,
    background: active ? '#4f46e5' : '#fff', color: active ? '#fff' : '#475569',
    fontWeight: active ? 700 : 500, transition: 'all .12s',
  };
}
