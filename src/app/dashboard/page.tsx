'use client';
// src/app/dashboard/page.tsx
import { useEffect, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import type { DashboardStats } from '@/types';
import { formatDate } from '@/lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { TrendingUp, Users, Zap, AlertTriangle, Clock, Building2, RefreshCw, Info } from 'lucide-react';

function Metric({ label, value, color, sub, accent }: { label: string; value: number | string; color?: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl p-4 border ${accent ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200'}`}>
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-3xl font-bold leading-none ${color || 'text-slate-900'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false); });
  }, []);

  if (loading || !stats) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64 text-slate-400">
          <RefreshCw className="animate-spin mr-2" size={16} /> Chargement…
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex items-center gap-3 mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
            {stats.lastImportDate && (
              <p className="text-xs text-slate-400 mt-0.5">
                Dernier import : {formatDate(stats.lastImportDate)} — {stats.lastImportFileName}
              </p>
            )}
          </div>
        </div>

        {/* Règle métier */}
        <div className="flex items-start gap-2.5 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 mb-6 text-xs text-indigo-700">
          <Info size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            <strong>Règle active :</strong> Toute nouvelle offre détectée pour un magasin existant
            remet automatiquement l&apos;affaire en <strong>« À appeler »</strong>.
            {stats.movedToCallLastImport > 0 && (
              <strong className="text-indigo-800"> {stats.movedToCallLastImport} affaire{stats.movedToCallLastImport > 1 ? 's' : ''} rappelée{stats.movedToCallLastImport > 1 ? 's' : ''} lors du dernier import.</strong>
            )}
          </span>
        </div>

        {/* Métriques principales */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <Metric label="Affaires totales"       value={stats.totalDeals}          sub={`${stats.totalStores} magasins`} />
          <Metric label="Nouvelles (dernier imp)" value={stats.newDealsLastImport}  color="text-emerald-600" />
          <Metric label="Nouvelles offres"        value={stats.updatedLastImport}   color="text-amber-600" sub="magasins existants" />
          <Metric label="Rappelées en À appeler"  value={stats.movedToCallLastImport} color="text-indigo-600" accent />
        </div>
        <div className="grid grid-cols-4 gap-3 mb-6">
          <Metric label="Offres actives"      value={stats.activeOffers}      sub={`${stats.disappearedOffers} disparues`} />
          <Metric label="Actions aujourd'hui" value={stats.actionsDueToday}   color="text-indigo-600" />
          <Metric label="Actions en retard"   value={stats.actionsOverdue}    color="text-red-600" />
          <Metric label="Sans action prévue"  value={stats.dealsWithNoAction} color="text-amber-600" />
        </div>

        {/* Graphiques */}
        <div className="grid grid-cols-2 gap-5">
          {/* Historique imports */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Activité des imports</h2>
            {stats.importHistory.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={stats.importHistory} barGap={2}>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={22} />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                      formatter={(v: number, name: string) => [v, name === 'created' ? 'Créées' : name === 'newOffers' ? 'Nouvelles offres' : 'Rappelées']}
                    />
                    <Bar dataKey="created"    name="Créées"          fill="#22c55e" radius={[3,3,0,0]} maxBarSize={20} />
                    <Bar dataKey="newOffers"  name="Nouvelles offres" fill="#f59e0b" radius={[3,3,0,0]} maxBarSize={20} />
                    <Bar dataKey="movedToCall" name="Rappelées"       fill="#6366f1" radius={[3,3,0,0]} maxBarSize={20} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-2 justify-center text-xs text-slate-500">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm inline-block" />Créées</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-amber-500 rounded-sm inline-block" />Nouvelles offres</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-indigo-500 rounded-sm inline-block" />Rappelées</span>
                </div>
              </>
            ) : (
              <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Aucun import encore</div>
            )}
          </div>

          {/* Top enseignes */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Affaires par enseigne</h2>
            {stats.topBrands.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={stats.topBrands.map(b => ({ name: b.name, value: b.count }))}
                      cx="50%" cy="50%" outerRadius={70} dataKey="value"
                      label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                      {stats.topBrands.map((b, i) => <Cell key={i} fill={b.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mt-2">
                  {stats.topBrands.map((b, i) => (
                    <span key={i} className="text-xs text-slate-500 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0" style={{ background: b.color }} />
                      {b.name} ({b.count})
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Aucune enseigne</div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
