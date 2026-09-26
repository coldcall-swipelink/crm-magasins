'use client';
// La cagnotte de primes dans la barre globale du CRM — juste à côté du suivi
// des objectifs : les deux se regardent ensemble, pendant qu'on appelle. Les
// objectifs disent où on en est ; la cagnotte dit ce que ça rapporte.
//
// La pastille montre la cagnotte de la période (la projection de Smartlink
// Brain, où les règles vivent) ; un clic ouvre le détail : démos payées,
// bonus clients, ce qui attend, la prime d'équipe, les versements passés.
//
// La pastille sait disparaître : elle ne concerne QUE les Sales primés
// (PRIME_SALES côté Brain — Luca Ayme et Mark Bongoy par défaut). Pas de
// cagnotte prévue pour l'utilisateur, Brain injoignable ou API en erreur =
// rien, plutôt qu'un zéro qui se lirait comme « rien gagné ».
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '@/lib/currentUser';
import { formatCurrency } from '@/lib/utils';

// ─── Types (la forme exacte de /api/primes) ─────────────────────────────────
type StoreType = 'hyper' | 'super' | 'proxy';

interface Mine {
  person: string;
  demos: number;
  byType: Record<StoreType, number>;
  clients: number;
  amount: number;
  pending: number;
  pendingAmount: number;
  noShows: number;
  noShowLost: number;
}

interface Payload {
  available: boolean;
  reason?: string;
  person?: string | null;
  period?: {
    key: string; label: string; short: string; payLabel: string;
    status: 'upcoming' | 'running' | 'ended';
  };
  mine?: Mine | null;
  team?: {
    reached: boolean; total: number; perPerson: number;
    mrr: number; target: number; ratio: number;
    gapMrr: number; gapCredits: number; payLabel: string;
    frozen: { paidAt: string; reached: boolean; perPerson: number } | null;
  };
  history?: { key: string; label: string; short: string; paidAt: string; amount: number }[];
}

/** Une cagnotte bouge au rythme des démos : cinq minutes suffisent. */
const REFRESH_MS = 5 * 60_000;

const STORE_TYPE_LABELS: Record<StoreType, string> = { hyper: 'hyper', super: 'super', proxy: 'proxi' };

/** « 5 hyper · 6 super · 3 proxi » — seuls les formats non nuls. */
function byTypeLabel(byType: Record<StoreType, number>): string {
  return (Object.keys(STORE_TYPE_LABELS) as StoreType[])
    .filter(t => byType[t] > 0)
    .map(t => `${byType[t]} ${STORE_TYPE_LABELS[t]}`)
    .join(' · ');
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

// ─── Le composant ───────────────────────────────────────────────────────────
export default function PrimesPocket() {
  const { user, ready } = useCurrentUser();
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const r = await fetch(`/api/primes?userId=${encodeURIComponent(user.id)}`);
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [user]);

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

  // Pas d'identité, API en erreur, Brain injoignable, ou utilisateur non
  // primé : la pastille s'efface — elle n'a rien de vrai à dire.
  if (!ready || !user || failed || !data || !data.available) return null;
  const { period, mine, team, history } = data;
  if (!period || !mine || !team) return null;

  // Ce que dit la pastille : la cagnotte Sales de la personne, plus sa part
  // d'équipe quand elle est acquise (figée, ou palier atteint).
  const teamShare = team.frozen ? (team.frozen.reached ? team.frozen.perPerson : 0) : team.reached ? team.perPerson : 0;
  const total = mine.amount + teamShare;
  const projection = period.status !== 'ended' && !team.frozen;

  return (
    <div ref={rootRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={`Cagnotte de primes ${period.short} — ${projection ? 'projection, ' : ''}versement ${period.payLabel} · cliquer pour le détail`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          height: 30, padding: '0 12px', borderRadius: 999,
          border: `1px solid ${open ? '#fcd34d' : '#fde68a'}`,
          background: open ? '#fef3c7' : '#fffbeb',
          fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
          whiteSpace: 'nowrap', transition: 'all .15s',
        }}
      >
        <span style={{ fontWeight: 700, color: '#92400e' }}>🪙 Cagnotte</span>
        <span style={{ fontWeight: 800, color: '#78350f' }}>{formatCurrency(total)}</span>
        {mine.pending > 0 && (
          <span style={{ color: '#b45309', fontWeight: 500, fontSize: 11 }}>
            +{formatCurrency(mine.pendingAmount)} en attente
          </span>
        )}
        <span style={{ color: '#d97706', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={panel}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>
              🪙 Cagnotte de primes · {period.short}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase',
              color: projection ? '#b45309' : '#15803d',
            }}>
              {projection ? 'Projection' : team.frozen ? 'Versée' : 'Cagnotte'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, marginBottom: 10 }}>
            Période {period.label} — versement {period.payLabel}.
          </div>

          <Row label="Démos faites payées" value={String(mine.demos)}
            sub={mine.demos > 0 ? byTypeLabel(mine.byType) : 'aucune démo faite sur la période'} />
          <Row label="Affaires devenues clientes" value={String(mine.clients)}
            sub="le bonus client est compris dans la cagnotte" />
          <Row label="Cagnotte de la période" value={formatCurrency(mine.amount)} strong />
          {mine.pending > 0 && (
            <Row label="Démos calées, pas encore faites" value={String(mine.pending)}
              sub={`+${formatCurrency(mine.pendingAmount)} une fois faites (hors bonus client)`} />
          )}
          {mine.noShows > 0 && (
            <Row label="No-shows non rattrapés" value={String(mine.noShows)}
              sub={`${formatCurrency(mine.noShowLost)} manqués`} />
          )}

          <div style={{ borderTop: '1px solid #f1f5f9', margin: '10px 0 8px' }} />
          <div style={sectionTitle}>Prime d&apos;équipe</div>
          {team.frozen ? (
            <div style={{ fontSize: 11.5, color: '#475569' }}>
              {team.frozen.reached
                ? <>Palier atteint : <b>{formatCurrency(team.frozen.perPerson)}</b> chacun, versée le {fmtDay(team.frozen.paidAt)}.</>
                : <>Palier non atteint — figé le {fmtDay(team.frozen.paidAt)} : rien à verser.</>}
            </div>
          ) : team.reached ? (
            <div style={{ fontSize: 11.5, color: '#15803d' }}>
              Palier atteint ✓ — <b>{formatCurrency(team.perPerson)}</b> chacun, {team.payLabel}.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, fontSize: 11.5, color: '#475569' }}>
                <span>MRR {formatCurrency(team.mrr)} / {formatCurrency(team.target)}</span>
                <span style={{ fontWeight: 700 }}>{Math.round(team.ratio * 100)} %</span>
              </div>
              <div style={{ position: 'relative', height: 6, background: '#f1f5f9', borderRadius: 999, marginTop: 4, overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, width: `${Math.min(100, team.ratio * 100)}%`, background: '#d97706', borderRadius: 999 }} />
              </div>
              <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 3 }}>
                Au palier ({formatCurrency(team.target)} de MRR en décembre 2026) : {formatCurrency(team.perPerson)} chacun
                — il manque {formatCurrency(team.gapMrr)}, soit {team.gapCredits} crédit{team.gapCredits > 1 ? 's' : ''}.
              </div>
            </>
          )}

          {history && history.length > 0 && (
            <>
              <div style={{ borderTop: '1px solid #f1f5f9', margin: '10px 0 8px' }} />
              <div style={sectionTitle}>Déjà versé</div>
              {history.map(h => (
                <div key={h.key} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
                  <span style={{ fontSize: 11.5, color: '#64748b' }}>{h.short} · le {fmtDay(h.paidAt)}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>{formatCurrency(h.amount)}</span>
                </div>
              ))}
            </>
          )}

          <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 10 }}>
            {projection
              ? 'Projection : tout se calcule et se fige le jour du versement, dans Smartlink Brain.'
              : 'Montants figés dans Smartlink Brain — le détail par démo se vérifie dans son onglet Primes.'}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sous-composants et styles ──────────────────────────────────────────────

function Row({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div style={{ padding: '5px 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#475569' }}>{label}</span>
        <span style={{ fontSize: strong ? 14 : 13, fontWeight: 800, color: strong ? '#92400e' : '#0f172a' }}>{value}</span>
      </div>
      {sub && <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const sectionTitle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px',
  textTransform: 'uppercase', marginBottom: 6,
};

const panel: React.CSSProperties = {
  position: 'absolute', top: 38, left: 0, zIndex: 60, width: 360,
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
  boxShadow: '0 12px 32px rgba(15,23,42,.14)', padding: '12px 14px',
};
