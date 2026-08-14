'use client';
// src/components/settings/PhoneLookupPanel.tsx
// Écran de pilotage de la recherche automatique des numéros de magasins
// (Paramètres). Deux parties :
//
//   1. LA CAMPAGNE — un bouton lance le traitement de toute la base. Le travail
//      est découpé en lots côté serveur ; cet écran rappelle la route en boucle
//      jusqu'à épuisement, ce qui permet d'afficher l'avancement en direct et
//      d'arrêter à tout moment sans rien perdre (chaque magasin traité est
//      marqué en base).
//
//   2. LA FILE DE REVUE — les numéros plausibles mais non certains. Un clic
//      valide ou écarte : c'est la seule charge manuelle qui subsiste, et elle
//      ne porte que sur les cas réellement ambigus.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/Toast';

const btnPri: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnDef: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnXs: React.CSSProperties = { padding: '3px 9px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#334155', cursor: 'pointer', fontSize: 11.5, fontWeight: 500 };

interface Stats {
  total: number; withPhone: number; pending: number; toReview: number; notFound: number;
  googleConfigured: boolean;
}
interface Candidate {
  phone: string; source: string; name: string; address: string;
  score: number; reasons: string[]; url: string; distanceKm: number | null;
}
interface ReviewItem {
  storeId: string; dealId: string | null; label: string; address: string; candidates: Candidate[];
}
type Scope = 'nouveaux' | 'echecs' | 'tout';

const SCOPE_LABELS: Record<Scope, string> = {
  nouveaux: 'Magasins jamais cherchés',
  echecs: 'Relancer les magasins non résolus',
  tout: 'Tous les magasins sans numéro',
};

export default function PhoneLookupPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [scope, setScope] = useState<Scope>('nouveaux');
  const [useGoogle, setUseGoogle] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, found: 0, toReview: 0, notFound: 0, remaining: 0 });
  const [lastLines, setLastLines] = useState<string[]>([]);
  // Drapeau lu à chaque tour de boucle : permet d'arrêter proprement entre deux
  // lots sans interrompre un lot en cours (qui serait alors à moitié écrit).
  const stopRef = useRef(false);

  const loadStats = useCallback(async () => {
    const res = await fetch('/api/phone-lookup');
    if (res.ok) setStats(await res.json());
  }, []);

  const loadReview = useCallback(async () => {
    const res = await fetch('/api/phone-lookup/review?limit=30');
    if (res.ok) {
      const data = await res.json();
      setReview(data.items || []);
      setReviewTotal(data.total || 0);
    }
  }, []);

  useEffect(() => { loadStats(); loadReview(); }, [loadStats, loadReview]);

  // ── Campagne ───────────────────────────────────────────────────────────────
  const run = async () => {
    if (running) return;
    stopRef.current = false;
    setRunning(true);
    setProgress({ processed: 0, found: 0, toReview: 0, notFound: 0, remaining: 0 });
    setLastLines([]);

    try {
      for (;;) {
        if (stopRef.current) break;

        const res = await fetch('/api/phone-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 25, scope, useGoogle }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast(data.error || 'Erreur pendant la recherche', 'error');
          break;
        }
        const report = await res.json();

        setProgress(p => ({
          processed: p.processed + report.processed,
          found: p.found + report.found,
          toReview: p.toReview + report.toReview,
          notFound: p.notFound + report.notFound,
          remaining: report.remaining,
        }));
        setLastLines(
          (report.results || []).slice(-12).map((r: { status: string; label: string; phone: string; candidates: unknown[] }) => {
            const icon = r.status === 'trouve' ? '✅' : r.status === 'a_verifier' ? '🟠' : r.status === 'erreur' ? '❌' : '⚪';
            const detail = r.phone || (r.status === 'a_verifier' ? `${r.candidates.length} proposition(s)` : '—');
            return `${icon} ${r.label} → ${detail}`;
          }),
        );

        if (report.stopped) { toast(report.stopped, 'error'); break; }
        // Plus rien à traiter dans le périmètre : la campagne est terminée.
        if (report.processed === 0 || report.remaining === 0) break;
      }
      toast('✓ Recherche terminée');
    } catch {
      toast('Recherche interrompue', 'error');
    } finally {
      setRunning(false);
      await Promise.all([loadStats(), loadReview()]);
    }
  };

  // ── File de revue ──────────────────────────────────────────────────────────
  const decide = async (storeId: string, phone: string | null) => {
    // Retrait immédiat de la liste : la décision est sans ambiguïté, inutile de
    // faire patienter sur l'aller-retour serveur.
    setReview(items => items.filter(i => i.storeId !== storeId));
    setReviewTotal(t => Math.max(0, t - 1));

    const res = await fetch('/api/phone-lookup/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(phone ? { storeId, phone } : { storeId, reject: true }),
    });
    if (!res.ok) {
      toast('Échec de l\'enregistrement', 'error');
      await loadReview();
      return;
    }
    toast(phone ? `✓ ${phone} enregistré` : 'Proposition écartée');
    await loadStats();
    // La liste n'est rechargée que lorsqu'elle se vide, pour ne pas la faire
    // sauter sous le curseur à chaque décision.
    if (review.length <= 1) await loadReview();
  };

  const coverage = stats && stats.total > 0 ? Math.round((stats.withPhone / stats.total) * 100) : 0;

  return (
    <div style={{ marginBottom: 28, border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, background: '#f8fafc' }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Numéros de téléphone des magasins</div>
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
        Retrouve automatiquement le numéro de chaque magasin : d&apos;abord sur OpenStreetMap (gratuit), puis, pour le
        reliquat, sur la fiche Google de l&apos;établissement. Un numéro n&apos;est enregistré d&apos;office que si
        l&apos;enseigne, le code postal, la ville et la position concordent ; les cas douteux atterrissent dans la file
        de vérification ci-dessous. Un numéro déjà saisi à la main n&apos;est jamais écrasé.
      </p>

      {/* Compteurs */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 12 }}>
          {([
            ['Magasins', stats.total, '#0f172a'],
            ['Avec numéro', `${stats.withPhone} (${coverage}%)`, '#059669'],
            ['À chercher', stats.pending, '#4f46e5'],
            ['À vérifier', stats.toReview, '#d97706'],
            ['Non résolus', stats.notFound, '#94a3b8'],
          ] as const).map(([label, value, color]) => (
            <div key={label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Réglages + lancement */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <select
          value={scope}
          onChange={e => setScope(e.target.value as Scope)}
          disabled={running}
          style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a', fontSize: 13 }}
        >
          {(Object.keys(SCOPE_LABELS) as Scope[]).map(s => (
            <option key={s} value={s}>{SCOPE_LABELS[s]}</option>
          ))}
        </select>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: stats?.googleConfigured ? '#334155' : '#94a3b8' }}>
          <input
            type="checkbox"
            checked={useGoogle && !!stats?.googleConfigured}
            disabled={running || !stats?.googleConfigured}
            onChange={e => setUseGoogle(e.target.checked)}
          />
          Utiliser Google Places {stats && !stats.googleConfigured && '(clé non configurée)'}
        </label>

        {running ? (
          <button style={btnDef} onClick={() => { stopRef.current = true; }}>■ Arrêter</button>
        ) : (
          <button style={btnPri} onClick={run}>▶ Lancer la recherche</button>
        )}
      </div>

      {/* Avancement en direct */}
      {(running || progress.processed > 0) && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, color: '#334155', fontWeight: 600, marginBottom: 6 }}>
            {running ? '⟳ Recherche en cours…' : 'Dernière campagne'} — {progress.processed} magasin(s) traité(s)
            {progress.remaining > 0 && `, ${progress.remaining} restant(s)`}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
            ✅ {progress.found} enregistrés · 🟠 {progress.toReview} à vérifier · ⚪ {progress.notFound} non résolus
          </div>
          {lastLines.length > 0 && (
            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, color: '#475569', maxHeight: 160, overflowY: 'auto', lineHeight: 1.7 }}>
              {lastLines.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}
        </div>
      )}

      {/* File de vérification */}
      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
            À vérifier {reviewTotal > 0 && <span style={{ color: '#d97706' }}>({reviewTotal})</span>}
          </div>
          <button style={btnXs} onClick={loadReview}>↻ Rafraîchir</button>
        </div>

        {review.length === 0 ? (
          <div style={{ fontSize: 12.5, color: '#94a3b8' }}>
            Aucun numéro en attente de vérification.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {review.map(item => (
              <div key={item.storeId} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{item.label}</div>
                    <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{item.address}</div>
                  </div>
                  <button style={{ ...btnXs, color: '#b91c1c', borderColor: '#fecaca' }} onClick={() => decide(item.storeId, null)}>
                    Aucun ne convient
                  </button>
                </div>

                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {item.candidates.map(c => (
                    <div key={c.phone} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#f8fafc', borderRadius: 7, padding: '7px 10px' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>{c.phone}</span>
                      <span style={{ fontSize: 11.5, color: '#475569', flex: 1, minWidth: 160 }}>
                        {c.name}
                        {c.address && <span style={{ color: '#94a3b8' }}> · {c.address}</span>}
                      </span>
                      <span style={{ fontSize: 10.5, color: '#94a3b8' }}>
                        {c.source === 'google' ? 'Google' : 'OpenStreetMap'} · {c.reasons.join(', ')}
                      </span>
                      {c.url && (
                        <a href={c.url} target="_blank" rel="noreferrer" style={{ ...btnXs, textDecoration: 'none', color: '#4f46e5' }}>
                          Voir la fiche ↗
                        </a>
                      )}
                      <button style={{ ...btnXs, background: '#4f46e5', color: '#fff', borderColor: '#4f46e5' }} onClick={() => decide(item.storeId, c.phone)}>
                        Utiliser
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
