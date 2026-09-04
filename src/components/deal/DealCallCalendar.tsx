'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { callOutcomeStyle, CALL_OUTCOME_STYLES, CALL_OUTCOME_UNKNOWN } from '@/lib/callOutcomes';

/**
 * Calendrier des appels d'une affaire — l'onglet « Calendrier » de la fiche.
 *
 * Une SEMAINE TYPE, et non un mois calendaire : tous les appels de l'affaire
 * sont rabattus sur un même quadrillage jour de la semaine × heure. Un appel
 * passé un lundi à 10 h et un autre le lundi suivant à 11 h se retrouvent donc
 * sur la même colonne « Lundi », l'un à 10 h, l'autre à 11 h.
 *
 * C'est la lecture qu'on vient chercher : à quelle heure ce magasin décroche,
 * et à quelle heure le décisionnaire n'est jamais joignable. Chaque appel est
 * une pastille colorée par le résultat renseigné dans la pop-up qui suit
 * l'appel : vert s'il a été joint, rouge s'il n'était pas sur le magasin,
 * orange s'il était en réunion ou a refusé de prendre l'appel.
 *
 * Lecture seule : rien ne se crée ici, les appels arrivent du clic sur
 * « Afficher le numéro ».
 */

export interface DealCall {
  id: string;
  calledAt: string;
  userName: string;
  phone: string;
  connected: boolean | null;
  outcome: string | null;
}

interface Props {
  dealId: string;
  /** Change à chaque réponse à la pop-up : force le rechargement des appels. */
  refreshKey?: number;
}

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

/** Plage horaire toujours affichée, même sans appel : la journée de prospection. */
const HEURE_MIN_PAR_DEFAUT = 8;
const HEURE_MAX_PAR_DEFAUT = 19;

/** Colonne de la semaine type (0 = lundi), quel que soit le jour réel de l'appel. */
function jourSemaine(d: Date): number {
  return (d.getDay() + 6) % 7;
}

const heure = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const dateComplete = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

/** « lundi 4 mai » → « Lundi 4 mai » (le français ne capitalise que le premier mot). */
const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function DealCallCalendar({ dealId, refreshKey = 0 }: Props) {
  const [calls, setCalls] = useState<DealCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Créneau dont on déplie le détail, « jour-heure » (null = aucun).
  const [creneauOuvert, setCreneauOuvert] = useState<string | null>(null);

  const charger = useCallback(() => {
    let annule = false;
    setLoading(true); setError(false);
    // Sans paramètre de mois : les douze derniers mois d'appels, de quoi
    // dégager une habitude plutôt qu'une semaine isolée.
    fetch(`/api/deals/${dealId}/calls`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { if (!annule) setCalls(d.calls || []); })
      .catch(() => { if (!annule) { setError(true); setCalls([]); } })
      .finally(() => { if (!annule) setLoading(false); });
    return () => { annule = true; };
  }, [dealId]);

  useEffect(() => charger(), [charger, refreshKey]);

  // Appels regroupés par créneau de la semaine type, du plus ancien au plus
  // récent dans le créneau.
  const parCreneau = useMemo(() => {
    const map = new Map<string, DealCall[]>();
    for (const c of calls) {
      const d = new Date(c.calledAt);
      const cle = `${jourSemaine(d)}-${d.getHours()}`;
      const liste = map.get(cle);
      if (liste) liste.push(c); else map.set(cle, [c]);
    }
    for (const liste of Array.from(map.values())) {
      liste.sort((a, b) => a.calledAt.localeCompare(b.calledAt));
    }
    return map;
  }, [calls]);

  // La grille couvre la journée de prospection, élargie si des appels sont
  // sortis de cette plage : aucun appel ne doit rester invisible.
  const heures = useMemo(() => {
    let min = HEURE_MIN_PAR_DEFAUT;
    let max = HEURE_MAX_PAR_DEFAUT;
    for (const c of calls) {
      const h = new Date(c.calledAt).getHours();
      if (h < min) min = h;
      if (h > max) max = h;
    }
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }, [calls]);

  // Compteurs, par couleur : le résumé qu'on vient chercher avant de décider
  // quand rappeler.
  const resume = useMemo(() => {
    const compte = { joint: 0, absent: 0, indispo: 0, sansReponse: 0 };
    for (const c of calls) {
      if (c.outcome === 'JOINT' || (!c.outcome && c.connected === true)) compte.joint++;
      else if (c.outcome === 'REUNION' || c.outcome === 'REFUS') compte.indispo++;
      else if (c.outcome === 'ABSENT' || (!c.outcome && c.connected === false)) compte.absent++;
      else compte.sansReponse++;
    }
    return compte;
  }, [calls]);

  const detail = creneauOuvert ? parCreneau.get(creneauOuvert) ?? [] : [];

  if (loading) return <p style={{ color: '#94a3b8', fontSize: 13 }}>Chargement des appels…</p>;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>Semaine type</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          {calls.length} appel{calls.length > 1 ? 's' : ''} sur les 12 derniers mois, replacés à leur jour et à leur heure
        </span>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 13px', fontSize: 12.5, color: '#b91c1c', marginBottom: 12 }}>
          Impossible de charger les appels de cette affaire.
        </div>
      )}

      {/* Grille : un jour par colonne, une heure par ligne. */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(7, 1fr)', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <div />
          {JOURS.map((j, i) => (
            <div key={j} style={{
              padding: '7px 4px', textAlign: 'center', fontSize: 11, fontWeight: 700,
              letterSpacing: '.3px', color: i > 4 ? '#a1a9b8' : '#64748b',
            }}>
              {j}
            </div>
          ))}
        </div>

        {heures.map(h => (
          <div key={h} style={{ display: 'grid', gridTemplateColumns: '52px repeat(7, 1fr)', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{
              padding: '6px 8px', fontSize: 11, fontWeight: 600, color: '#94a3b8', textAlign: 'right',
              borderRight: '1px solid #f1f5f9', fontVariantNumeric: 'tabular-nums', background: '#fcfdfe',
            }}>
              {String(h).padStart(2, '0')}h
            </div>
            {JOURS.map((jour, j) => {
              const cle = `${j}-${h}`;
              const duCreneau = parCreneau.get(cle) ?? [];
              const ouvert = creneauOuvert === cle;
              return (
                <div
                  key={cle}
                  onClick={() => duCreneau.length > 0 && setCreneauOuvert(ouvert ? null : cle)}
                  title={duCreneau.length > 0
                    ? `${jour} ${String(h).padStart(2, '0')}h — ${duCreneau.length} appel${duCreneau.length > 1 ? 's' : ''}`
                    : undefined}
                  style={{
                    minHeight: 32, borderRight: '1px solid #f1f5f9', padding: '4px 3px',
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 3,
                    background: ouvert ? '#eef2ff' : j > 4 ? '#fcfdfe' : '#fff',
                    cursor: duCreneau.length > 0 ? 'pointer' : 'default',
                    outline: ouvert ? '2px solid #c7d2fe' : 'none', outlineOffset: -2,
                  }}
                >
                  {/* Une pastille par appel : le créneau montre d'un coup d'œil
                      s'il a déjà donné quelque chose, et combien de fois. */}
                  {duCreneau.slice(0, 4).map(c => {
                    const st = callOutcomeStyle(c.outcome, c.connected);
                    return (
                      <span
                        key={c.id}
                        title={`${majuscule(dateComplete(c.calledAt))} à ${heure(c.calledAt)} — ${st.label}${c.userName ? ` · ${c.userName}` : ''}`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          minWidth: 34, height: 17, padding: '0 5px', borderRadius: 4,
                          background: st.bg, border: `1px solid ${st.border}`, color: st.text,
                          fontSize: 9.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1,
                        }}
                      >
                        {heure(c.calledAt)}
                      </span>
                    );
                  })}
                  {duCreneau.length > 4 && (
                    <span style={{ fontSize: 9.5, fontWeight: 800, color: '#6366f1' }}>+{duCreneau.length - 4}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Légende + compteurs. Les pastilles reprennent les couleurs des appels
          (source unique : callOutcomes) — une légende qui diverge de la grille
          est pire que pas de légende. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 11.5, color: '#64748b' }}>
        {([
          [CALL_OUTCOME_STYLES.JOINT.dot, 'Décisionnaire joint', resume.joint, true],
          [CALL_OUTCOME_STYLES.ABSENT.dot, 'Pas sur le magasin', resume.absent, true],
          [CALL_OUTCOME_STYLES.REUNION.dot, 'En réunion / refus', resume.indispo, true],
          [CALL_OUTCOME_UNKNOWN.dot, 'Sans réponse', resume.sansReponse, resume.sansReponse > 0],
        ] as const).filter(([, , , visible]) => visible).map(([couleur, libelle, nombre]) => (
          <span key={libelle}>
            <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: couleur, marginRight: 5 }} />
            {libelle} ({nombre})
          </span>
        ))}
      </div>

      {/* Détail du créneau cliqué : les appels de la semaine type y perdent leur
          date, on la rend ici pour pouvoir remonter à l'appel exact. */}
      {creneauOuvert && detail.length > 0 && (
        <div style={{ marginTop: 16, border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
              {JOURS[Number(creneauOuvert.split('-')[0])]} · {String(creneauOuvert.split('-')[1]).padStart(2, '0')}h
            </span>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{detail.length} appel{detail.length > 1 ? 's' : ''}</span>
            <button type="button" onClick={() => setCreneauOuvert(null)}
              style={{ marginLeft: 'auto', border: 'none', background: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {detail.slice().reverse().map(c => {
              const st = callOutcomeStyle(c.outcome, c.connected);
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: st.bg, border: `1px solid ${st.border}`, borderRadius: 8, padding: '7px 11px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: st.dot, flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: st.text, fontVariantNumeric: 'tabular-nums' }}>{heure(c.calledAt)}</span>
                  <span style={{ fontSize: 12.5, color: st.text }}>{st.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {[majuscule(dateComplete(c.calledAt)), c.userName].filter(Boolean).join(' · ')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!error && calls.length === 0 && (
        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 14 }}>
          Aucun appel sur les 12 derniers mois. Chaque clic sur « Afficher le numéro » dans la fiche s&apos;inscrit ici.
        </p>
      )}
    </>
  );
}
