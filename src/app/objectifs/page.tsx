'use client';
// « Mes objectifs » : chaque utilisateur suit ici, en direct, les objectifs
// que Smartlink Brain lui a fixés — appels passés, démos bookées, closings —
// plus les décisionnaires joints et les taux qui vont avec.
//
// Les cibles viennent de Brain (via /api/objectives, qui interroge son export) ;
// le réalisé est recalculé ici à chaque ouverture, à la source, avec les mêmes
// conventions de comptage que Brain. La page reste utile quand Brain ne répond
// pas : le réalisé s'affiche, les objectifs manquent, et un bandeau le dit.
import { useEffect, useMemo, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { useCurrentUser } from '@/lib/currentUser';
import { formatCurrency, formatDate } from '@/lib/utils';
import S from '@/lib/styles';

// ---------------------------------------------------------------------------
// Types (la forme exacte de /api/objectives)
// ---------------------------------------------------------------------------
type PeriodType = 'week' | 'month' | 'quarter' | 'year';

interface Period {
  type: PeriodType;
  key: string;
  label: string;
  from: string;
  to: string;
  /** Part de la période écoulée (semaine = jours ouvrés). */
  elapsed: number;
  current: boolean;
  past?: boolean;
}

interface Payload {
  periods: Period[];
  period: Period;
  user: { name: string; person: string | null };
  brain: { available: boolean; reason?: string; computedAt?: string };
  targets: { calls: number | null; demos: number | null; closings: number | null };
  actuals: { calls: number; connected: number; demos: number; closings: number; closingsValue: number };
  generatedAt: string;
}

const PERIOD_TYPE_LABELS: { type: PeriodType; label: string }[] = [
  { type: 'week', label: 'Semaine' },
  { type: 'month', label: 'Mois' },
  { type: 'quarter', label: 'Trimestre' },
  { type: 'year', label: 'Année' },
];

const fmtShort = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const pct = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null);
const fmtPct = (v: number | null) => (v === null ? '—' : `${v.toFixed(0)} %`);

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function ObjectifsPage() {
  const { user, ready } = useCurrentUser();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [periodKey, setPeriodKey] = useState<string | null>(null); // null = semaine en cours

  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    const qs = new URLSearchParams({ userId: user.id });
    if (periodKey) qs.set('period', periodKey);
    setError(null);
    fetch(`/api/objectives?${qs}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `Erreur ${r.status}`);
        return r.json() as Promise<Payload>;
      })
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [ready, user, periodKey]);

  const period = data?.period ?? null;

  // Les périodes proposées pour l'horizon affiché : l'en-cours puis l'historique.
  const siblings = useMemo(
    () => (data && period ? data.periods.filter(p => p.type === period.type) : []),
    [data, period],
  );

  if (!ready || (!data && !error)) {
    return <AppLayout><div style={center}>Chargement…</div></AppLayout>;
  }
  if (error) {
    return <AppLayout><div style={center}>Erreur de chargement des objectifs : {error}</div></AppLayout>;
  }
  if (!data || !period) return null;

  const { actuals, targets, brain } = data;
  const connectedRate = pct(actuals.connected, actuals.calls);
  const demoPerCall = pct(actuals.demos, actuals.calls);
  const demoPerConnected = pct(actuals.demos, actuals.connected);
  const closingPerDemo = pct(actuals.closings, actuals.demos);
  // Les closings ne s'affichent que pour ceux qui en portent : un objectif non
  // nul, ou un closing bien réel sur la période (qu'il serait absurde de taire).
  const showClosings = (targets.closings ?? 0) !== 0 || actuals.closings > 0;

  return (
    <AppLayout>
      <div style={{ padding: '20px 24px', maxWidth: 1180 }}>
        {/* En-tête */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>🎯 Mes objectifs</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            {data.user.name} · maj {formatDate(data.generatedAt)}
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 16 }}>
          Objectifs fixés dans Smartlink Brain · réalisé calculé en direct sur le CRM.
        </div>

        {/* Sélection de la période */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {PERIOD_TYPE_LABELS.map(t => (
              <button
                key={t.type}
                onClick={() => {
                  const cur = data.periods.find(p => p.type === t.type && p.current);
                  if (cur) setPeriodKey(cur.key);
                }}
                style={pill(period.type === t.type)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select
            value={period.key}
            onChange={e => setPeriodKey(e.target.value)}
            style={{ ...selectInp, minWidth: 210 }}
          >
            {siblings.map(p => (
              <option key={p.key} value={p.key}>
                {p.label}{p.current ? ' (en cours)' : ''} · {fmtShort(p.from)} → {fmtShort(p.to)}
              </option>
            ))}
          </select>
          {!period.past && (
            <span style={{ fontSize: 12, color: '#94a3b8' }}>
              {Math.round(period.elapsed * 100)} % de la période écoulée
              {period.type === 'week' ? ' (jours ouvrés)' : ''}
            </span>
          )}
        </div>

        {/* Liaison Brain : la page reste utile sans elle, mais elle le dit. */}
        {!brain.available && (
          <div style={{ ...S.alertWarn, marginBottom: 12 }}>
            Objectifs indisponibles — {brain.reason || 'Smartlink Brain ne répond pas'}. Le réalisé reste affiché.
          </div>
        )}
        {brain.available && data.user.person === null && (
          <div style={{ ...S.alertInfo, marginBottom: 12 }}>
            <span>ℹ️</span>
            <span>
              Aucun objectif individuel n&apos;est prévu pour « {data.user.name} » dans Smartlink Brain
              (équipe Sales de l&apos;onglet Objectifs). Le réalisé reste affiché.
            </span>
          </div>
        )}

        {/* Cartes objectif : réalisé face à la cible, au rythme de la période */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${showClosings ? 4 : 3}, minmax(0, 1fr))`, gap: 12, marginBottom: 12 }}>
          <ObjectiveCard
            icon="📞"
            label="Appels passés"
            actual={actuals.calls}
            target={targets.calls}
            elapsed={period.elapsed}
            past={!!period.past}
          />
          <ObjectiveCard
            icon="🎙️"
            label="Décisionnaires joints"
            actual={actuals.connected}
            target={null}
            elapsed={period.elapsed}
            past={!!period.past}
            sub={connectedRate === null ? 'aucun appel sur la période' : `${fmtPct(connectedRate)} des appels`}
          />
          <ObjectiveCard
            icon="📅"
            label="Démos bookées"
            actual={actuals.demos}
            target={targets.demos}
            elapsed={period.elapsed}
            past={!!period.past}
          />
          {showClosings && (
            <ObjectiveCard
              icon="✍️"
              label="Closings"
              actual={actuals.closings}
              target={targets.closings}
              elapsed={period.elapsed}
              past={!!period.past}
              sub={actuals.closings > 0 ? `${formatCurrency(actuals.closingsValue)} de MRR closé` : undefined}
            />
          )}
        </div>

        {/* Les taux associés */}
        <div style={sectionTitle}>Taux de la période</div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${showClosings ? 4 : 3}, minmax(0, 1fr))`, gap: 12, marginBottom: 24 }}>
          <RateCard
            label="Taux de décisionnaires joints"
            value={fmtPct(connectedRate)}
            sub={`${actuals.connected} joint${actuals.connected > 1 ? 's' : ''} / ${actuals.calls} appel${actuals.calls > 1 ? 's' : ''}`}
          />
          <RateCard
            label="Taux de démo par appel"
            value={fmtPct(demoPerCall)}
            sub={`${actuals.demos} démo${actuals.demos > 1 ? 's' : ''} / ${actuals.calls} appel${actuals.calls > 1 ? 's' : ''}`}
          />
          <RateCard
            label="Taux de démo par décisionnaire joint"
            value={fmtPct(demoPerConnected)}
            sub={`${actuals.demos} démo${actuals.demos > 1 ? 's' : ''} / ${actuals.connected} joint${actuals.connected > 1 ? 's' : ''}`}
          />
          {showClosings && (
            <RateCard
              label="Taux de closing par démo"
              value={fmtPct(closingPerDemo)}
              sub={`${actuals.closings} closing${actuals.closings > 1 ? 's' : ''} / ${actuals.demos} démo${actuals.demos > 1 ? 's' : ''}`}
            />
          )}
        </div>

        <div style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.6 }}>
          Conventions de comptage — les mêmes que Smartlink Brain : un appel = une ligne du journal
          d&apos;appels (« Afficher le numéro » en mode prospection) ; un décisionnaire joint = un appel
          marqué « joint » ; une démo comptée à sa date de prise de rendez-vous ; un closing = un client
          signé non résilié, dédoublonné par affaire, crédité au closeur.
        </div>
      </div>
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------
// Sous-composants
// ---------------------------------------------------------------------------

/**
 * Une carte objectif : le réalisé en grand, la cible, et une jauge qui situe
 * le rythme — le repère vertical marque où il FAUDRAIT en être à ce stade de
 * la période. Sans cible : le chiffre seul, la jauge n'aurait rien à dire.
 */
function ObjectiveCard({ icon, label, actual, target, elapsed, past, sub }: {
  icon: string;
  label: string;
  actual: number;
  target: number | null;
  elapsed: number;
  past: boolean;
  sub?: string;
}) {
  const hasTarget = target !== null && target > 0;
  const ratio = hasTarget ? actual / target : null;
  const expected = hasTarget ? Math.ceil(target * elapsed) : null;
  // Le statut se juge contre le rythme, pas contre la cible entière : à mi-mois,
  // 50 % de fait est « dans les temps », pas « à moitié raté ».
  const reached = ratio !== null && ratio >= 1;
  const onPace = ratio !== null && !reached && actual >= (expected ?? 0);
  const late = ratio !== null && !reached && !onPace;
  const barColor = reached ? '#16a34a' : late && (past || elapsed > 0.3) ? '#d97706' : '#4f46e5';

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 5 }}>{icon} {label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 25, fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>
          {actual.toLocaleString('fr-FR')}
          {hasTarget && (
            <span style={{ fontSize: 14, fontWeight: 600, color: '#94a3b8' }}> / {target.toLocaleString('fr-FR')}</span>
          )}
        </div>
        {hasTarget && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
            color: reached ? '#15803d' : late ? '#b45309' : '#4338ca',
            background: reached ? '#dcfce7' : late ? '#fef3c7' : '#eef2ff',
          }}>
            {reached ? 'Atteint ✓' : past ? 'Manqué' : late ? 'En retard' : 'Dans les temps'}
          </span>
        )}
      </div>

      {hasTarget && (
        <div style={{ position: 'relative', height: 8, background: '#f1f5f9', borderRadius: 999, marginTop: 10, overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', inset: 0, width: `${Math.min(100, (ratio ?? 0) * 100)}%`,
            background: barColor, borderRadius: 999, transition: 'width .3s',
          }} />
          {/* Le repère du rythme : où il faudrait en être aujourd'hui. */}
          {!past && elapsed > 0 && elapsed < 1 && (
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${elapsed * 100}%`, width: 2, background: '#0f172a', opacity: 0.35 }} />
          )}
        </div>
      )}

      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
        {hasTarget
          ? past
            ? `${Math.round((ratio ?? 0) * 100)} % de l'objectif`
            : reached
              ? `objectif atteint · ${Math.round((ratio ?? 0) * 100)} %`
              : `attendu à ce stade : ${expected} · reste ${Math.max(0, target - actual)}`
          : sub ?? (target === 0 ? 'objectif à zéro sur la période' : 'aucun objectif fixé sur la période')}
      </div>
      {hasTarget && sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function RateCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{sub}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const center: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', height: 220, color: '#94a3b8' };
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#0f172a', margin: '4px 0 10px' };
const selectInp: React.CSSProperties = { height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#334155', fontSize: 12.5, outline: 'none', cursor: 'pointer' };
function pill(active: boolean): React.CSSProperties {
  return {
    height: 34, padding: '0 12px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer',
    border: `1px solid ${active ? '#6366f1' : '#e2e8f0'}`,
    background: active ? '#4f46e5' : '#fff', color: active ? '#fff' : '#475569',
    fontWeight: active ? 700 : 500, transition: 'all .12s',
  };
}
