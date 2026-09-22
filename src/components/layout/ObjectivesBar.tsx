'use client';
// Suivi des objectifs dans la barre globale du CRM — à côté du mode
// prospection, pas dans un onglet : les objectifs se regardent toute la
// journée, pendant qu'on appelle, pas en allant les chercher.
//
// La barre montre l'essentiel de la période (appels, décisionnaires joints,
// démos bookées, closings — face aux cibles fixées dans Smartlink Brain) ;
// un clic ouvre le détail : changement de période, jauges au rythme, taux
// associés. Le réalisé se rafraîchit tout seul pendant une session d'appels.
//
// La barre sait disparaître : pas d'utilisateur identifié ou API en erreur =
// rien, plutôt qu'une rangée de zéros faux. Brain injoignable, en revanche,
// n'efface rien : le réalisé s'affiche sans cibles, et le détail le dit.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '@/lib/currentUser';
import { formatCurrency } from '@/lib/utils';

// ─── Types (la forme exacte de /api/objectives) ─────────────────────────────
type PeriodType = 'week' | 'month' | 'quarter' | 'year';

interface Period {
  type: PeriodType;
  key: string;
  label: string;
  from: string;
  to: string;
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

/** Le réalisé bouge à chaque appel : deux minutes, pour suivre sans marteler. */
const REFRESH_MS = 2 * 60_000;

const fmtShort = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const pct = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null);
const fmtPct = (v: number | null) => (v === null ? '—' : `${v.toFixed(0)} %`);

/**
 * Où en est un chiffre face à sa cible, jugé contre le RYTHME de la période :
 * à mi-mois, 50 % de fait est « dans les temps », pas « à moitié raté ».
 */
type Pace = 'reached' | 'onPace' | 'late' | 'none';
function paceOf(actual: number, target: number | null, elapsed: number): Pace {
  if (target === null || target <= 0) return 'none';
  if (actual >= target) return 'reached';
  return actual >= Math.ceil(target * elapsed) ? 'onPace' : 'late';
}
const PACE_COLORS: Record<Pace, string> = {
  reached: '#15803d',
  onPace: '#4338ca',
  late: '#b45309',
  none: '#475569',
};

// ─── Le composant ───────────────────────────────────────────────────────────
export default function ObjectivesBar() {
  const { user, ready } = useCurrentUser();
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [periodKey, setPeriodKey] = useState<string | null>(null); // null = semaine en cours
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const qs = new URLSearchParams({ userId: user.id });
      if (periodKey) qs.set('period', periodKey);
      const r = await fetch(`/api/objectives?${qs}`);
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [user, periodKey]);

  useEffect(() => {
    if (!ready || !user) return;
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [ready, user, load]);

  // Le détail se referme d'un clic ailleurs : c'est un coup d'œil, pas un écran.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // Pas d'identité ou API en erreur : la barre s'efface plutôt que d'afficher
  // des zéros qui se liraient comme « rien fait aujourd'hui ».
  if (!ready || !user || failed || !data) return null;

  const { actuals, targets, brain, period } = data;
  const connectedRate = pct(actuals.connected, actuals.calls);
  // Les closings ne s'affichent que pour ceux qui en portent : un objectif non
  // nul, ou un closing bien réel sur la période.
  const showClosings = (targets.closings ?? 0) !== 0 || actuals.closings > 0;
  const siblings = data.periods.filter(p => p.type === period.type);

  return (
    <div ref={rootRef} style={{ position: 'relative', minWidth: 0 }}>
      {/* Le résumé, cliquable : ce qu'on surveille en appelant. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={brain.available
          ? 'Objectifs fixés dans Smartlink Brain · cliquer pour le détail et les taux'
          : `Objectifs indisponibles (${brain.reason || 'Smartlink Brain ne répond pas'}) · le réalisé reste affiché`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 14,
          height: 30, padding: '0 12px', borderRadius: 999,
          border: `1px solid ${open ? '#c7d2fe' : '#e2e8f0'}`,
          background: open ? '#eef2ff' : '#f8fafc',
          fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
          whiteSpace: 'nowrap', transition: 'all .15s', maxWidth: '100%', overflow: 'hidden',
        }}
      >
        <span style={{ fontWeight: 700, color: '#334155' }}>🎯 {period.label}</span>
        <MiniStat icon="📞" actual={actuals.calls} target={targets.calls} elapsed={period.elapsed} />
        <MiniStat icon="🎙️" actual={actuals.connected} target={null} elapsed={period.elapsed}
          extra={connectedRate === null ? undefined : fmtPct(connectedRate)} />
        <MiniStat icon="📅" actual={actuals.demos} target={targets.demos} elapsed={period.elapsed} />
        {showClosings && (
          <MiniStat icon="✍️" actual={actuals.closings} target={targets.closings} elapsed={period.elapsed} />
        )}
        {!brain.available && <span title="Cibles injoignables">⚠️</span>}
        <span style={{ color: '#94a3b8', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* Le détail : périodes, jauges au rythme, taux associés. */}
      {open && (
        <div style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {PERIOD_TYPE_LABELS.map(t => (
              <button
                key={t.type}
                onClick={() => {
                  const cur = data.periods.find(p => p.type === t.type && p.current);
                  if (cur) setPeriodKey(cur.key);
                }}
                style={smallPill(period.type === t.type)}
              >
                {t.label}
              </button>
            ))}
            <select
              value={period.key}
              onChange={e => setPeriodKey(e.target.value)}
              style={smallSelect}
            >
              {siblings.map(p => (
                <option key={p.key} value={p.key}>
                  {p.label}{p.current ? ' (en cours)' : ''} · {fmtShort(p.from)} → {fmtShort(p.to)}
                </option>
              ))}
            </select>
          </div>
          {!period.past && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
              {Math.round(period.elapsed * 100)} % de la période écoulée
              {period.type === 'week' ? ' (jours ouvrés)' : ''} — le trait marque où il faudrait en être.
            </div>
          )}

          {!brain.available && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', fontSize: 11.5, color: '#78350f', marginBottom: 10 }}>
              Objectifs indisponibles — {brain.reason || 'Smartlink Brain ne répond pas'}. Le réalisé reste affiché.
            </div>
          )}
          {brain.available && data.user.person === null && (
            <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '8px 10px', fontSize: 11.5, color: '#3730a3', marginBottom: 10 }}>
              Aucun objectif individuel n&apos;est prévu pour « {data.user.name} » dans Smartlink Brain.
            </div>
          )}

          <DetailRow icon="📞" label="Appels passés" actual={actuals.calls} target={targets.calls} elapsed={period.elapsed} past={!!period.past} />
          <DetailRow icon="🎙️" label="Décisionnaires joints" actual={actuals.connected} target={null} elapsed={period.elapsed} past={!!period.past}
            sub={connectedRate === null ? 'aucun appel sur la période' : `${fmtPct(connectedRate)} des appels`} />
          <DetailRow icon="📅" label="Démos bookées" actual={actuals.demos} target={targets.demos} elapsed={period.elapsed} past={!!period.past} />
          {showClosings && (
            <DetailRow icon="✍️" label="Closings" actual={actuals.closings} target={targets.closings} elapsed={period.elapsed} past={!!period.past}
              sub={actuals.closings > 0 ? `${formatCurrency(actuals.closingsValue)} de MRR closé` : undefined} />
          )}

          <div style={{ borderTop: '1px solid #f1f5f9', margin: '10px 0 8px' }} />
          <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase', marginBottom: 6 }}>
            Taux de la période
          </div>
          <RateLine label="Décisionnaires joints / appels" value={fmtPct(connectedRate)} detail={`${actuals.connected} / ${actuals.calls}`} />
          <RateLine label="Démos / appels" value={fmtPct(pct(actuals.demos, actuals.calls))} detail={`${actuals.demos} / ${actuals.calls}`} />
          <RateLine label="Démos / décisionnaires joints" value={fmtPct(pct(actuals.demos, actuals.connected))} detail={`${actuals.demos} / ${actuals.connected}`} />
          {showClosings && (
            <RateLine label="Closings / démos" value={fmtPct(pct(actuals.closings, actuals.demos))} detail={`${actuals.closings} / ${actuals.demos}`} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sous-composants ────────────────────────────────────────────────────────

/** Un chiffre de la barre : « 45/200 », coloré selon le rythme. */
function MiniStat({ icon, actual, target, elapsed, extra }: {
  icon: string;
  actual: number;
  target: number | null;
  elapsed: number;
  extra?: string;
}) {
  const pace = paceOf(actual, target, elapsed);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3, color: PACE_COLORS[pace], fontWeight: 700 }}>
      <span>{icon}</span>
      <span>{actual.toLocaleString('fr-FR')}</span>
      {target !== null && target > 0 && (
        <span style={{ color: '#94a3b8', fontWeight: 500 }}>/{target.toLocaleString('fr-FR')}</span>
      )}
      {extra && <span style={{ color: '#94a3b8', fontWeight: 500, fontSize: 11 }}>· {extra}</span>}
    </span>
  );
}

/** Une ligne du détail : chiffre face à la cible, jauge au rythme de la période. */
function DetailRow({ icon, label, actual, target, elapsed, past, sub }: {
  icon: string;
  label: string;
  actual: number;
  target: number | null;
  elapsed: number;
  past: boolean;
  sub?: string;
}) {
  const hasTarget = target !== null && target > 0;
  const pace = paceOf(actual, target, elapsed);
  const ratio = hasTarget ? actual / target : 0;
  const expected = hasTarget ? Math.ceil(target * elapsed) : null;
  const barColor = pace === 'reached' ? '#16a34a' : pace === 'late' && (past || elapsed > 0.3) ? '#d97706' : '#4f46e5';

  return (
    <div style={{ padding: '6px 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#475569' }}>{icon} {label}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>
          {actual.toLocaleString('fr-FR')}
          {hasTarget && <span style={{ fontSize: 11.5, fontWeight: 600, color: '#94a3b8' }}> / {target.toLocaleString('fr-FR')}</span>}
        </span>
      </div>
      {hasTarget && (
        <div style={{ position: 'relative', height: 6, background: '#f1f5f9', borderRadius: 999, marginTop: 4, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, width: `${Math.min(100, ratio * 100)}%`, background: barColor, borderRadius: 999 }} />
          {!past && elapsed > 0 && elapsed < 1 && (
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${elapsed * 100}%`, width: 2, background: '#0f172a', opacity: 0.35 }} />
          )}
        </div>
      )}
      <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 3 }}>
        {hasTarget
          ? past
            ? `${Math.round(ratio * 100)} % de l'objectif${pace === 'reached' ? ' · atteint ✓' : ''}`
            : pace === 'reached'
              ? 'objectif atteint ✓'
              : `attendu à ce stade : ${expected} · reste ${Math.max(0, (target ?? 0) - actual)}`
          : sub ?? (target === 0 ? 'objectif à zéro sur la période' : 'aucun objectif fixé sur la période')}
        {hasTarget && sub ? ` · ${sub}` : ''}
      </div>
    </div>
  );
}

function RateLine({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
      <span style={{ fontSize: 11.5, color: '#64748b' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>
        {value} <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: 10.5 }}>({detail})</span>
      </span>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const panel: React.CSSProperties = {
  position: 'absolute', top: 38, left: 0, zIndex: 60, width: 380,
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
  boxShadow: '0 12px 32px rgba(15,23,42,.14)', padding: '12px 14px',
};
const smallSelect: React.CSSProperties = {
  height: 26, padding: '0 6px', borderRadius: 7, border: '1px solid #e2e8f0',
  background: '#fff', color: '#334155', fontSize: 11.5, outline: 'none', cursor: 'pointer', flex: 1, minWidth: 0,
};
function smallPill(active: boolean): React.CSSProperties {
  return {
    height: 26, padding: '0 9px', borderRadius: 7, fontSize: 11.5, cursor: 'pointer',
    border: `1px solid ${active ? '#6366f1' : '#e2e8f0'}`,
    background: active ? '#4f46e5' : '#fff', color: active ? '#fff' : '#475569',
    fontWeight: active ? 700 : 500,
  };
}
