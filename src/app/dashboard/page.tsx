'use client';
import { useEffect, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import type { DashboardStats } from '@/types';
import { formatDate } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  useEffect(() => { fetch('/api/dashboard').then(r => r.json()).then(setStats); }, []);

  if (!stats) return <AppLayout><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#94a3b8' }}>Chargement…</div></AppLayout>;

  const M = ({ label, value, color, sub, accent }: { label: string; value: number | string; color?: string; sub?: string; accent?: boolean }) => (
    <div style={{ background: accent ? '#eef2ff' : '#fff', border: `1px solid ${accent ? '#c7d2fe' : '#e2e8f0'}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || '#0f172a', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{sub}</div>}
    </div>
  );

  return (
    <AppLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1000 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Dashboard</div>
        {stats.lastImportDate && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14 }}>Dernier import : {formatDate(stats.lastImportDate)} — {stats.lastImportFileName}</div>}

        <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '10px 14px', marginBottom: 18, fontSize: 12, color: '#3730a3', display: 'flex', gap: 8 }}>
          ℹ️ <span><strong>Règle active :</strong> Toute nouvelle offre détectée remet l&apos;affaire en <strong>« À appeler »</strong>.</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 10 }}>
          <M label="Affaires totales" value={stats.totalDeals} sub={`${stats.totalStores} magasins`} />
          <M label="Nouvelles (dernier imp.)" value={stats.newDealsLastImport} color="#16a34a" />
          <M label="Rappelées en À appeler" value={stats.movedToCallLastImport} color="#4338ca" accent />
          <M label="Offres actives" value={stats.activeOffers} sub={`${stats.disappearedOffers} disparues`} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 24 }}>
          <M label="Actions aujourd'hui" value={stats.actionsDueToday} color="#4f46e5" />
          <M label="En retard" value={stats.actionsOverdue} color="#dc2626" />
          <M label="Sans action" value={stats.dealsWithNoAction} color="#d97706" />
          <M label="Imports total" value={stats.importHistory.length} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Activité des imports</div>
            {stats.importHistory.length ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={stats.importHistory}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={22} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  <Bar dataKey="created" name="Créées" fill="#22c55e" radius={[3, 3, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="newOffers" name="Nouvelles offres" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="movedToCall" name="Rappelées" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>Aucun import encore</div>}
          </div>

          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Affaires par enseigne</div>
            {stats.topBrands.length ? (
              <>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart><Pie data={stats.topBrands.map(b => ({ name: b.name, value: b.count }))} cx="50%" cy="50%" outerRadius={65} dataKey="value">
                    {stats.topBrands.map((b, i) => <Cell key={i} fill={b.color} />)}
                  </Pie><Tooltip contentStyle={{ fontSize: 11 }} /></PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {stats.topBrands.map((b, i) => <span key={i} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, color: '#475569' }}><span style={{ width: 8, height: 8, borderRadius: 2, background: b.color, display: 'inline-block' }} />{b.name} ({b.count})</span>)}
                </div>
              </>
            ) : <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>Aucune enseigne</div>}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
