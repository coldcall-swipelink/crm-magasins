'use client';
import { useEffect, useMemo, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, PieChart, Pie, Cell, Legend,
} from 'recharts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Closing {
  id: string;
  value: number;
  closingDate: string;
  paymentMode: 'stripe' | 'virement';
  subscriptions: { type: string; value: number; months: number }[];
  storeName: string;
  city: string;
  brandId: string | null;
  brandName: string;
  brandColor: string;
}
interface ClosingData {
  deals: Closing[];
  brands: { id: string; name: string; color: string }[];
  generatedAt: string;
}

type PresetKey = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'last12' | 'all' | 'custom';

interface Range { start: Date; end: Date; prevStart: Date | null; prevEnd: Date | null; label: string; prevLabel: string; }

// ---------------------------------------------------------------------------
// Helpers dates
// ---------------------------------------------------------------------------
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function buildRange(preset: PresetKey, customFrom: string, customTo: string, now: Date): Range {
  const y = now.getFullYear(), m = now.getMonth();
  switch (preset) {
    case 'thisMonth': {
      const start = new Date(y, m, 1);
      return { start, end: now, prevStart: new Date(y, m - 1, 1), prevEnd: addMonths(now, -1), label: 'Ce mois-ci', prevLabel: 'Mois précédent (à date)' };
    }
    case 'lastMonth': {
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 1);
      return { start, end, prevStart: new Date(y, m - 2, 1), prevEnd: new Date(y, m - 1, 1), label: 'Mois dernier', prevLabel: "Mois d'avant" };
    }
    case 'thisQuarter': {
      const q = Math.floor(m / 3);
      const start = new Date(y, q * 3, 1);
      return { start, end: now, prevStart: new Date(y, q * 3 - 3, 1), prevEnd: addMonths(now, -3), label: 'Ce trimestre', prevLabel: 'Trimestre précédent (à date)' };
    }
    case 'thisYear': {
      const start = new Date(y, 0, 1);
      return { start, end: now, prevStart: new Date(y - 1, 0, 1), prevEnd: new Date(y - 1, m, now.getDate(), now.getHours(), now.getMinutes()), label: 'Cette année', prevLabel: 'Année précédente (à date)' };
    }
    case 'last12': {
      const start = addMonths(now, -12);
      return { start, end: now, prevStart: addMonths(now, -24), prevEnd: addMonths(now, -12), label: '12 derniers mois', prevLabel: '12 mois précédents' };
    }
    case 'all':
      // Aucune borne : inclut aussi les closings datés dans le futur, pour
      // coïncider avec le MRR cumulé (qui n'applique aucun filtre de date).
      return { start: new Date(2000, 0, 1), end: new Date(9999, 11, 31), prevStart: null, prevEnd: null, label: 'Tout le temps', prevLabel: '' };
    case 'custom': {
      const start = customFrom ? new Date(customFrom + 'T00:00:00') : new Date(2000, 0, 1);
      const end = customTo ? new Date(customTo + 'T23:59:59') : now;
      const durationMs = end.getTime() - start.getTime();
      const prevEnd = new Date(start.getTime());
      const prevStart = new Date(start.getTime() - durationMs);
      return { start, end, prevStart, prevEnd, label: 'Personnalisé', prevLabel: 'Période précédente équivalente' };
    }
  }
  // Repli (inatteignable, tous les presets sont couverts) — sécurise le typage.
  return { start: new Date(2000, 0, 1), end: now, prevStart: null, prevEnd: null, label: '', prevLabel: '' };
}

// ---------------------------------------------------------------------------
// Helpers calcul
// ---------------------------------------------------------------------------
const inRange = (iso: string, start: Date, end: Date) => {
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t <= end.getTime();
};
const sumValue = (deals: Closing[]) => deals.reduce((s, d) => s + (d.value || 0), 0);
function pctDelta(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null; // null = pas de base de comparaison
  return ((cur - prev) / prev) * 100;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const [data, setData] = useState<ClosingData | null>(null);
  const [error, setError] = useState(false);
  const [preset, setPreset] = useState<PresetKey>('thisYear');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [brandId, setBrandId] = useState<string>('');

  useEffect(() => {
    fetch('/api/dashboard/closing')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const now = useMemo(() => new Date(), []);
  const range = useMemo(() => buildRange(preset, customFrom, customTo, now), [preset, customFrom, customTo, now]);

  // Closings filtrés par enseigne (avant filtre période).
  const byBrand = useMemo(
    () => (data?.deals ?? []).filter(d => !brandId || d.brandId === brandId),
    [data, brandId],
  );

  // « Tout » = aucun filtre de date (inclut les closings à dates aberrantes,
  // passées comme futures) → coïncide exactement avec le MRR cumulé.
  const current = useMemo(
    () => preset === 'all' ? byBrand : byBrand.filter(d => inRange(d.closingDate, range.start, range.end)),
    [byBrand, range, preset],
  );
  const previous = useMemo(
    () => (range.prevStart && range.prevEnd ? byBrand.filter(d => inRange(d.closingDate, range.prevStart!, range.prevEnd!)) : []),
    [byBrand, range],
  );

  // KPIs période courante / précédente
  const mrr = sumValue(current);
  const mrrPrev = sumValue(previous);
  const clients = current.length;
  const clientsPrev = previous.length;
  const avg = clients ? mrr / clients : 0;
  const avgPrev = clientsPrev ? mrrPrev / clientsPrev : 0;
  const stripeCount = current.filter(d => d.paymentMode === 'stripe').length;
  const stripeShare = clients ? (stripeCount / clients) * 100 : 0;

  // ARR = MRR annualisé (la valeur saisie est mensuelle → × 12).
  const arr = mrr * 12;
  const arrPrev = mrrPrev * 12;

  // Cumul tout temps (sur l'enseigne filtrée)
  const mrrAllTime = sumValue(byBrand);
  const clientsAllTime = byBrand.length;
  const arrAllTime = mrrAllTime * 12;

  // Durée d'abonnement moyenne (mois), calculée sur les abonnements.
  const avgDurationOf = (deals: Closing[]) => {
    let total = 0, n = 0;
    for (const d of deals) for (const s of d.subscriptions ?? []) { total += s.months || 0; n += 1; }
    return n ? total / n : 0;
  };
  // Lifetime Value = MRR moyen par client × durée d'abonnement moyenne (mois).
  const arpuAllTime = clientsAllTime ? mrrAllTime / clientsAllTime : 0;
  const avgDurationAllTime = avgDurationOf(byBrand);
  const ltvAllTime = arpuAllTime * avgDurationAllTime;

  // Série temporelle (adaptative jour/mois selon la durée de la période)
  const series = useMemo(() => {
    const rangeDays = (range.end.getTime() - range.start.getTime()) / 86400000;
    const granularity: 'day' | 'month' = rangeDays <= 92 ? 'day' : 'month';
    const buckets = new Map<string, { key: string; label: string; mrr: number; clients: number }>();

    if (granularity === 'month') {
      // On clampe l'axe aux closings réels (évite des dizaines de mois vides
      // quand la période est « Tout » ou très large, y compris vers le futur).
      let axisStart = range.start;
      let axisEnd = range.end;
      if (current.length) {
        const times = current.map(d => new Date(d.closingDate).getTime());
        const minT = Math.min(...times);
        const maxT = Math.max(...times);
        if (minT > axisStart.getTime()) axisStart = new Date(minT);
        if (maxT < axisEnd.getTime()) axisEnd = new Date(maxT);
      }
      // Sécurité : on n'affiche au plus que ~120 mois finissant au dernier
      // closing (évite qu'une date aberrante vide le graphe).
      const floor = new Date(axisEnd.getFullYear(), axisEnd.getMonth() - 119, 1);
      if (axisStart.getTime() < floor.getTime()) axisStart = floor;
      const cur = new Date(axisStart.getFullYear(), axisStart.getMonth(), 1);
      const last = new Date(axisEnd.getFullYear(), axisEnd.getMonth(), 1);
      let guard = 0;
      while (cur <= last && guard < 120) {
        const k = monthKey(cur);
        buckets.set(k, { key: k, label: cur.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }), mrr: 0, clients: 0 });
        cur.setMonth(cur.getMonth() + 1);
        guard++;
      }
      for (const d of current) {
        const dt = new Date(d.closingDate);
        const b = buckets.get(monthKey(dt));
        if (b) { b.mrr += d.value || 0; b.clients += 1; }
      }
    } else {
      const cur = startOfDay(range.start);
      const last = startOfDay(range.end);
      // Garde-fou : au plus ~95 buckets jour.
      let guard = 0;
      while (cur <= last && guard < 120) {
        const k = dayKey(cur);
        buckets.set(k, { key: k, label: cur.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), mrr: 0, clients: 0 });
        cur.setDate(cur.getDate() + 1);
        guard++;
      }
      for (const d of current) {
        const dt = new Date(d.closingDate);
        const b = buckets.get(dayKey(dt));
        if (b) { b.mrr += d.value || 0; b.clients += 1; }
      }
    }
    return Array.from(buckets.values());
  }, [current, range]);

  // MRR par enseigne (période courante)
  const brandBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; color: string; mrr: number; clients: number }>();
    for (const d of current) {
      const key = d.brandId ?? d.brandName;
      const e = map.get(key) ?? { name: d.brandName, color: d.brandColor, mrr: 0, clients: 0 };
      e.mrr += d.value || 0; e.clients += 1;
      map.set(key, e);
    }
    return Array.from(map.values()).sort((a, b) => b.mrr - a.mrr);
  }, [current]);

  // Répartition du MRR par type d'abonnement (sur la période courante). On
  // additionne la valeur de chaque abonnement par type ; la valeur d'un deal
  // sans abonnement détaillé est rangée sous « Non renseigné ».
  const typeBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of current) {
      if (d.subscriptions && d.subscriptions.length) {
        for (const s of d.subscriptions) {
          const key = s.type?.trim() || 'Non renseigné';
          map.set(key, (map.get(key) ?? 0) + (s.value || 0));
        }
      } else if (d.value) {
        map.set('Non renseigné', (map.get('Non renseigné') ?? 0) + d.value);
      }
    }
    const palette = ['#4f46e5', '#8b5cf6', '#0ea5e9', '#16a34a', '#f59e0b', '#ec4899', '#14b8a6', '#ef4444', '#a855f7', '#64748b'];
    const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
    return Array.from(map.entries())
      .map(([name, value], i) => ({ name, value, color: name === 'Non renseigné' ? '#cbd5e1' : palette[i % palette.length], pct: total ? (value / total) * 100 : 0 }))
      .filter(s => s.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [current]);

  // Répartition mode de paiement (par MRR)
  const paymentBreakdown = useMemo(() => {
    const stripe = current.filter(d => d.paymentMode === 'stripe');
    const virement = current.filter(d => d.paymentMode === 'virement');
    return [
      { name: 'Stripe', value: sumValue(stripe), count: stripe.length, color: '#8b5cf6' },
      { name: 'Virement', value: sumValue(virement), count: virement.length, color: '#64748b' },
    ].filter(s => s.count > 0);
  }, [current]);

  // ---- Rendu --------------------------------------------------------------
  if (error) return <AppLayout><div style={center}>Erreur de chargement des données de closing.</div></AppLayout>;
  if (!data) return <AppLayout><div style={center}>Chargement…</div></AppLayout>;

  const presets: { key: PresetKey; label: string }[] = [
    { key: 'thisMonth', label: 'Ce mois' },
    { key: 'lastMonth', label: 'Mois dernier' },
    { key: 'thisQuarter', label: 'Trimestre' },
    { key: 'thisYear', label: 'Année' },
    { key: 'last12', label: '12 mois' },
    { key: 'all', label: 'Tout' },
    { key: 'custom', label: 'Personnalisé' },
  ];

  return (
    <AppLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1180 }}>
        {/* En-tête */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>📊 Closing &amp; MRR</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            {clientsAllTime} closing{clientsAllTime > 1 ? 's' : ''} au total · maj {formatDate(data.generatedAt)}
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 16 }}>
          Analyse des affaires gagnées (date de closing renseignée). MRR = somme de la valeur des deals.
        </div>

        {/* Barre de filtres */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {presets.map(p => (
              <button key={p.key} onClick={() => setPreset(p.key)} style={pill(preset === p.key)}>{p.label}</button>
            ))}
          </div>
          {preset === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={dateInp} />
              <span style={{ color: '#94a3b8', fontSize: 12 }}>→</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={dateInp} />
            </div>
          )}
          <div style={{ flex: 1 }} />
          <select value={brandId} onChange={e => setBrandId(e.target.value)} style={{ ...dateInp, minWidth: 170, cursor: 'pointer' }}>
            <option value="">Toutes les enseignes</option>
            {data.brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        {/* Période active */}
        <div style={{ fontSize: 12, color: '#475569', marginBottom: 12 }}>
          Période : <b>{preset === 'all' ? 'Tout l\'historique' : `${formatDate(range.start)} → ${formatDate(range.end)}`}</b>
          {range.prevLabel && <span style={{ color: '#94a3b8' }}> · comparé à : {range.prevLabel}</span>}
        </div>

        {/* KPIs période (avec comparaison) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 12 }}>
          <Kpi label="MRR de la période" value={formatCurrency(mrr) || '0 €'} delta={pctDelta(mrr, mrrPrev)} prev={range.prevLabel ? formatCurrency(mrrPrev) || '0 €' : null} accent />
          <Kpi label="ARR (annualisé)" value={formatCurrency(arr) || '0 €'} delta={pctDelta(arr, arrPrev)} prev={range.prevLabel ? formatCurrency(arrPrev) || '0 €' : null} />
          <Kpi label="Nouveaux clients" value={String(clients)} delta={pctDelta(clients, clientsPrev)} prev={range.prevLabel ? String(clientsPrev) : null} />
          <Kpi label="Panier moyen" value={formatCurrency(avg) || '0 €'} delta={pctDelta(avg, avgPrev)} prev={range.prevLabel ? formatCurrency(avgPrev) || '0 €' : null} />
          <Kpi label="Part Stripe" value={`${stripeShare.toFixed(0)} %`} sub={`${stripeCount}/${clients || 0} en Stripe`} />
        </div>

        {/* Cumul tout temps */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 24 }}>
          <Kpi label="MRR total cumulé" value={formatCurrency(mrrAllTime) || '0 €'} sub={brandId ? data.brands.find(b => b.id === brandId)?.name : 'toutes enseignes'} small />
          <Kpi label="ARR cumulé" value={formatCurrency(arrAllTime) || '0 €'} sub="MRR cumulé × 12" small />
          <Kpi label="Lifetime Value" value={formatCurrency(ltvAllTime) || '0 €'} sub={`${formatCurrency(arpuAllTime) || '0 €'}/client × ${avgDurationAllTime.toFixed(0)} mois`} small />
          <Kpi label="Clients au total" value={String(clientsAllTime)} sub="depuis le début" small />
          <Kpi label="Panier moyen global" value={formatCurrency(clientsAllTime ? mrrAllTime / clientsAllTime : 0) || '0 €'} sub="sur tout l'historique" small />
        </div>

        {/* Graphique principal : évolution MRR + clients */}
        <div style={card}>
          <div style={cardTitle}>Évolution du MRR &amp; des nouveaux clients</div>
          {series.length && current.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94a3b8' }} width={54} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} width={28} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={((value: any, name: any) => name === 'MRR' ? [formatCurrency(value), 'MRR'] : [value, 'Clients']) as any}
                />
                <Bar yAxisId="left" dataKey="mrr" name="MRR" fill="#4f46e5" radius={[3, 3, 0, 0]} maxBarSize={42} />
                <Line yAxisId="right" type="monotone" dataKey="clients" name="Clients" stroke="#16a34a" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <div style={emptyChart}>Aucun closing sur cette période</div>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginTop: 16 }}>
          {/* MRR par enseigne */}
          <div style={card}>
            <div style={cardTitle}>MRR par enseigne</div>
            {brandBreakdown.length ? (
              <ResponsiveContainer width="100%" height={Math.max(180, brandBreakdown.length * 34)}>
                <BarChart data={brandBreakdown} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} width={110} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={((v: any, _n: any, p: any) => [`${formatCurrency(v)} · ${p?.payload?.clients ?? 0} client(s)`, 'MRR']) as any} />
                  <Bar dataKey="mrr" radius={[0, 4, 4, 0]} maxBarSize={26}>
                    {brandBreakdown.map((b, i) => <Cell key={i} fill={b.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <div style={emptyChart}>Aucune donnée</div>}
          </div>

          {/* Mode de paiement */}
          <div style={card}>
            <div style={cardTitle}>Mode de paiement (MRR)</div>
            {paymentBreakdown.length ? (
              <>
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie data={paymentBreakdown} dataKey="value" cx="50%" cy="50%" innerRadius={42} outerRadius={66} paddingAngle={2}>
                      {paymentBreakdown.map((s, i) => <Cell key={i} fill={s.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 11 }} formatter={((v: any) => formatCurrency(v)) as any} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 4 }}>
                  {paymentBreakdown.map((s, i) => (
                    <div key={i} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{s.count} client(s)</div>
                    </div>
                  ))}
                </div>
              </>
            ) : <div style={emptyChart}>Aucune donnée</div>}
          </div>
        </div>

        {/* Répartition du MRR par type d'abonnement */}
        <div style={{ ...card, marginTop: 16 }}>
          <div style={cardTitle}>Répartition du MRR par type d&apos;abonnement</div>
          {typeBreakdown.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 16, alignItems: 'center' }}>
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie data={typeBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={88} paddingAngle={2}>
                    {typeBreakdown.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={((v: any, n: any) => [`${formatCurrency(v)} (${mrr ? ((v / mrr) * 100).toFixed(1) : 0} %)`, n]) as any} />
                </PieChart>
              </ResponsiveContainer>
              <div>
                {typeBreakdown.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: i < typeBreakdown.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                    <span style={{ width: 11, height: 11, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 12.5, color: '#334155', fontWeight: 500 }}>{s.name}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a', width: 56, textAlign: 'right' }}>{s.pct.toFixed(1)} %</span>
                    <span style={{ fontSize: 12, color: '#64748b', width: 90, textAlign: 'right' }}>{formatCurrency(s.value)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0 0', marginTop: 4, borderTop: '2px solid #e2e8f0' }}>
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>MRR total</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#15803d' }}>{formatCurrency(mrr) || '0 €'}</span>
                </div>
              </div>
            </div>
          ) : <div style={emptyChart}>Aucun abonnement sur cette période</div>}
        </div>

        {/* Table des closings de la période */}
        <div style={{ ...card, marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={cardTitle}>Closings de la période ({current.length})</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#4f46e5' }}>{formatCurrency(mrr) || '0 €'}</div>
          </div>
          {current.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#94a3b8', fontSize: 11 }}>
                    <th style={th}>Date</th><th style={th}>Magasin</th><th style={th}>Enseigne</th>
                    <th style={th}>Paiement</th><th style={{ ...th, textAlign: 'right' }}>Valeur</th>
                  </tr>
                </thead>
                <tbody>
                  {[...current].sort((a, b) => new Date(b.closingDate).getTime() - new Date(a.closingDate).getTime()).slice(0, 100).map(d => (
                    <tr key={d.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={td}>{formatDate(d.closingDate)}</td>
                      <td style={{ ...td, fontWeight: 600, color: '#0f172a' }}>{d.storeName || '—'}{d.city ? <span style={{ color: '#94a3b8', fontWeight: 400 }}> · {d.city}</span> : null}</td>
                      <td style={td}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: d.brandColor }} />{d.brandName}</span></td>
                      <td style={td}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999, color: d.paymentMode === 'stripe' ? '#6d28d9' : '#64748b', background: d.paymentMode === 'stripe' ? '#ede9fe' : '#f1f5f9' }}>
                          {d.paymentMode === 'stripe' ? 'Stripe' : 'Virement'}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#15803d' }}>{formatCurrency(d.value) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {current.length > 100 && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>100 premiers affichés sur {current.length}.</div>}
            </div>
          ) : <div style={emptyChart}>Aucun closing sur cette période</div>}
        </div>
      </div>
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------
// Sous-composants & styles
// ---------------------------------------------------------------------------
function Kpi({ label, value, delta, prev, sub, accent, small }: {
  label: string; value: string; delta?: number | null; prev?: string | null; sub?: string; accent?: boolean; small?: boolean;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <div style={{ background: accent ? '#eef2ff' : '#fff', border: `1px solid ${accent ? '#c7d2fe' : '#e2e8f0'}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: small ? 20 : 25, fontWeight: 800, color: accent ? '#4338ca' : '#0f172a', lineHeight: 1 }}>{value}</div>
        {delta !== undefined && delta !== null && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999, color: up ? '#15803d' : '#dc2626', background: up ? '#dcfce7' : '#fee2e2' }}>
            {up ? '▲' : '▼'} {Math.abs(delta).toFixed(0)} %
          </span>
        )}
        {delta === null && prev !== null && prev !== undefined && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999, color: '#9333ea', background: '#f3e8ff' }}>nouveau</span>
        )}
      </div>
      {prev !== null && prev !== undefined && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>période préc. : {prev}</div>}
      {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{sub}</div>}
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
