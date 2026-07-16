'use client';
import { useEffect, useMemo, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
// Une ligne = UNE échéance de paiement (une occurrence de l'échéancier d'un
// abonnement). Un abonnement mensuel génère donc plusieurs lignes.
interface Payment {
  id: string;
  subscriptionId: string;
  dealId: string;
  index: number;
  date: string;
  amount: number;
  type: string;
  paymentTiming: 'mensuel' | 'comptant';
  paymentMode: 'stripe' | 'virement';
  storeName: string;
  city: string;
  brandId: string | null;
  brandName: string;
  brandColor: string;
}
interface PaymentData {
  payments: Payment[];
  horizonMonths: number;
  brands: { id: string; name: string; color: string }[];
  generatedAt: string;
}

type WindowKey = 'next30' | 'next3m' | 'next6m' | 'next12m' | 'all';

// ---------------------------------------------------------------------------
// Helpers dates
// ---------------------------------------------------------------------------
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const windows: { key: WindowKey; label: string; months: number | null; days?: number }[] = [
  { key: 'next30', label: '30 jours', months: null, days: 30 },
  { key: 'next3m', label: '3 mois', months: 3 },
  { key: 'next6m', label: '6 mois', months: 6 },
  { key: 'next12m', label: '12 mois', months: 12 },
  { key: 'all', label: 'Tout', months: null },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function PaymentsPage() {
  const [data, setData] = useState<PaymentData | null>(null);
  const [error, setError] = useState(false);
  const [win, setWin] = useState<WindowKey>('next3m');
  const [brandId, setBrandId] = useState<string>('');
  const [timing, setTiming] = useState<'' | 'mensuel' | 'comptant'>('');

  useEffect(() => {
    fetch('/api/payments')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => startOfDay(now), [now]);

  // Borne de fin de la fenêtre sélectionnée (à partir d'aujourd'hui).
  const windowEnd = useMemo(() => {
    const w = windows.find(x => x.key === win)!;
    if (w.key === 'all') return addMonths(today, data?.horizonMonths ?? 60);
    if (w.days) return addDays(today, w.days);
    return addMonths(today, w.months ?? 12);
  }, [win, today, data]);

  // Échéances filtrées par enseigne / cadence, restreintes aux paiements à venir
  // (>= aujourd'hui). Les échéances déjà passées ne sont pas affichées.
  const filtered = useMemo(() => {
    const all = data?.payments ?? [];
    return all.filter(p => {
      if (brandId && p.brandId !== brandId) return false;
      if (timing && p.paymentTiming !== timing) return false;
      const t = new Date(p.date).getTime();
      return t >= today.getTime();
    });
  }, [data, brandId, timing, today]);

  // Échéances dans la fenêtre courante.
  const inWindow = useMemo(
    () => filtered.filter(p => new Date(p.date).getTime() <= windowEnd.getTime()),
    [filtered, windowEnd],
  );

  // KPIs
  const totalWindow = useMemo(() => inWindow.reduce((s, p) => s + p.amount, 0), [inWindow]);
  const next = useMemo(() => filtered[0] ?? null, [filtered]); // filtered déjà trié par date croissante
  const thisMonthTotal = useMemo(() => {
    const k = monthKey(today);
    return filtered.filter(p => monthKey(new Date(p.date)) === k).reduce((s, p) => s + p.amount, 0);
  }, [filtered, today]);
  const next30Total = useMemo(() => {
    const end = addDays(today, 30).getTime();
    return filtered.filter(p => new Date(p.date).getTime() <= end).reduce((s, p) => s + p.amount, 0);
  }, [filtered, today]);

  // Série : montant total par mois (sur les 12 prochains mois glissants).
  const series = useMemo(() => {
    const buckets = new Map<string, { key: string; label: string; amount: number; count: number }>();
    const cur = new Date(today.getFullYear(), today.getMonth(), 1);
    for (let i = 0; i < 12; i++) {
      const k = monthKey(cur);
      buckets.set(k, { key: k, label: cur.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }), amount: 0, count: 0 });
      cur.setMonth(cur.getMonth() + 1);
    }
    for (const p of filtered) {
      const b = buckets.get(monthKey(new Date(p.date)));
      if (b) { b.amount += p.amount; b.count += 1; }
    }
    return Array.from(buckets.values());
  }, [filtered, today]);

  // Regroupement du tableau par mois (dans la fenêtre courante).
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; total: number; rows: Payment[] }>();
    for (const p of inWindow) {
      const d = new Date(p.date);
      const k = monthKey(d);
      const g = map.get(k) ?? { key: k, label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }), total: 0, rows: [] };
      g.total += p.amount; g.rows.push(p);
      map.set(k, g);
    }
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [inWindow]);

  // ---- Rendu --------------------------------------------------------------
  if (error) return <AppLayout><div style={center}>Erreur de chargement des paiements.</div></AppLayout>;
  if (!data) return <AppLayout><div style={center}>Chargement…</div></AppLayout>;

  const totalUpcoming = filtered.reduce((s, p) => s + p.amount, 0);

  return (
    <AppLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1180 }}>
        {/* En-tête */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>💶 Prochains paiements</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            {filtered.length} échéance{filtered.length > 1 ? 's' : ''} à venir · horizon {Math.round((data.horizonMonths ?? 60) / 12)} ans · maj {formatDate(data.generatedAt)}
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 16 }}>
          Échéancier projeté à partir de la date de closing de chaque abonnement, selon le type et la cadence de paiement.
        </div>

        {/* Barre de filtres */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {windows.map(w => (
              <button key={w.key} onClick={() => setWin(w.key)} style={pill(win === w.key)}>{w.label}</button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <select value={timing} onChange={e => setTiming(e.target.value as any)} style={{ ...dateInp, minWidth: 140, cursor: 'pointer' }}>
            <option value="">Toutes cadences</option>
            <option value="mensuel">Mensuel</option>
            <option value="comptant">Comptant</option>
          </select>
          <select value={brandId} onChange={e => setBrandId(e.target.value)} style={{ ...dateInp, minWidth: 170, cursor: 'pointer' }}>
            <option value="">Toutes les enseignes</option>
            {data.brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        {/* Fenêtre active */}
        <div style={{ fontSize: 12, color: '#475569', marginBottom: 12 }}>
          Fenêtre : <b>{formatDate(today)} → {win === 'all' ? `${Math.round((data.horizonMonths ?? 60) / 12)} ans` : formatDate(windowEnd)}</b>
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          <Kpi label={`Total à venir (${windows.find(w => w.key === win)!.label})`} value={formatCurrency(totalWindow) || '0 €'} sub={`${inWindow.length} échéance(s)`} accent />
          <Kpi label="Prochains 30 jours" value={formatCurrency(next30Total) || '0 €'} sub="à partir d'aujourd'hui" />
          <Kpi label="Ce mois-ci" value={formatCurrency(thisMonthTotal) || '0 €'} sub={today.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })} />
          <Kpi
            label="Prochain paiement"
            value={next ? formatCurrency(next.amount) || '0 €' : '—'}
            sub={next ? `${formatDate(next.date)} · ${next.storeName || '—'}` : 'aucune échéance'}
          />
        </div>

        {/* Graphique : montant par mois (12 mois glissants) */}
        <div style={card}>
          <div style={cardTitle}>Paiements attendus par mois (12 prochains mois)</div>
          {series.some(s => s.amount > 0) ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={54} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={((value: any, _n: any, p: any) => [`${formatCurrency(value)} · ${p?.payload?.count ?? 0} échéance(s)`, 'Paiements']) as any}
                />
                <Bar dataKey="amount" name="Paiements" radius={[3, 3, 0, 0]} maxBarSize={46} fill="#4f46e5">
                  {series.map((s, i) => <Cell key={i} fill={s.key === monthKey(today) ? '#16a34a' : '#4f46e5'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div style={emptyChart}>Aucun paiement attendu sur les 12 prochains mois</div>}
        </div>

        {/* Tableau des échéances de la fenêtre, groupées par mois */}
        <div style={{ ...card, marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={cardTitle}>Échéancier ({inWindow.length})</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#4f46e5' }}>{formatCurrency(totalWindow) || '0 €'}</div>
          </div>
          {groups.length ? (
            <div style={{ overflowX: 'auto' }}>
              {groups.map(g => (
                <div key={g.key} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: '#f8fafc', borderRadius: 7, marginBottom: 2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', textTransform: 'capitalize' }}>{g.label}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#15803d' }}>{formatCurrency(g.total)} · {g.rows.length} échéance(s)</span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: '#94a3b8', fontSize: 11 }}>
                        <th style={th}>Date</th><th style={th}>Magasin</th><th style={th}>Enseigne</th>
                        <th style={th}>Type</th><th style={th}>Cadence</th><th style={{ ...th, textAlign: 'right' }}>Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map(p => (
                        <tr key={p.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                          <td style={td}>{formatDate(p.date)}</td>
                          <td style={{ ...td, fontWeight: 600, color: '#0f172a' }}>{p.storeName || '—'}{p.city ? <span style={{ color: '#94a3b8', fontWeight: 400 }}> · {p.city}</span> : null}</td>
                          <td style={td}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: p.brandColor }} />{p.brandName}</span></td>
                          <td style={{ ...td, color: p.type ? '#334155' : '#cbd5e1' }}>{p.type || '—'}</td>
                          <td style={td}>
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999, color: p.paymentTiming === 'mensuel' ? '#0369a1' : '#4338ca', background: p.paymentTiming === 'mensuel' ? '#e0f2fe' : '#eef2ff' }}>
                              {p.paymentTiming === 'mensuel' ? 'Mensuel' : 'Comptant'}
                            </span>
                          </td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#15803d' }}>{formatCurrency(p.amount) || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : <div style={emptyChart}>Aucune échéance sur cette fenêtre</div>}
        </div>
      </div>
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------
// Sous-composants & styles
// ---------------------------------------------------------------------------
function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{ background: accent ? '#eef2ff' : '#fff', border: `1px solid ${accent ? '#c7d2fe' : '#e2e8f0'}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: accent ? '#4338ca' : '#0f172a', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

const center: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', height: 220, color: '#94a3b8' };
const card: React.CSSProperties = { background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 16 };
const cardTitle: React.CSSProperties = { fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#0f172a' };
const emptyChart: React.CSSProperties = { height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 };
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '7px 8px', color: '#334155' };
const dateInp: React.CSSProperties = { height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#334155', fontSize: 12.5, outline: 'none' };
function pill(active: boolean): React.CSSProperties {
  return {
    height: 34, padding: '0 12px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer',
    border: `1px solid ${active ? '#6366f1' : '#e2e8f0'}`,
    background: active ? '#4f46e5' : '#fff', color: active ? '#fff' : '#475569',
    fontWeight: active ? 700 : 500, transition: 'all .12s',
  };
}
