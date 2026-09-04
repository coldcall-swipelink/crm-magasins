'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { callOutcomeStyle } from '@/lib/callOutcomes';

/**
 * Calendrier des appels d'une affaire — l'onglet « Calendrier » de la fiche.
 *
 * Un mois par écran, un appel par pastille, colorée par le résultat renseigné
 * dans la pop-up qui suit l'appel : vert si le décisionnaire a été joint, rouge
 * s'il n'était pas sur le magasin, orange s'il était en réunion ou a refusé de
 * prendre l'appel. Lu en travers, le mois dit quand ce magasin est joignable.
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
  /** Change à chaque réponse à la pop-up : force le rechargement du mois. */
  refreshKey?: number;
}

/** « YYYY-MM » d'une date locale. */
function moisDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** « YYYY-MM » décalé de n mois. */
function moisDecale(mois: string, n: number): string {
  const [y, m] = mois.split('-').map(Number);
  return moisDe(new Date(y, m - 1 + n, 1));
}

/** « YYYY-MM-DD » d'une date locale (clé de regroupement par jour). */
function jourDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/**
 * Les cases du mois affiché, semaines commencées le lundi : on complète par les
 * jours débordants du mois précédent et du suivant pour obtenir des lignes
 * pleines.
 */
function casesDuMois(mois: string): { date: Date; key: string; horsMois: boolean }[] {
  const [y, m] = mois.split('-').map(Number);
  const premier = new Date(y, m - 1, 1);
  // getDay() : 0 = dimanche. On veut 0 = lundi.
  const decalage = (premier.getDay() + 6) % 7;
  const debut = new Date(y, m - 1, 1 - decalage);

  const cases: { date: Date; key: string; horsMois: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(debut.getFullYear(), debut.getMonth(), debut.getDate() + i);
    cases.push({ date, key: jourDe(date), horsMois: date.getMonth() !== m - 1 });
  }
  // Sixième semaine inutile (mois court commençant un lundi) : on la retire.
  return cases.slice(0, cases[35].date.getMonth() === m - 1 ? 42 : 35);
}

const heure = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** « vendredi 4 septembre » → « Vendredi 4 septembre » (le français ne capitalise que le premier mot). */
const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function DealCallCalendar({ dealId, refreshKey = 0 }: Props) {
  const [mois, setMois] = useState(() => moisDe(new Date()));
  const [calls, setCalls] = useState<DealCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Jour dont on déplie le détail (null = aucun).
  const [jourOuvert, setJourOuvert] = useState<string | null>(null);

  const charger = useCallback((m: string) => {
    let annule = false;
    setLoading(true); setError(false);
    fetch(`/api/deals/${dealId}/calls?month=${m}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { if (!annule) setCalls(d.calls || []); })
      .catch(() => { if (!annule) { setError(true); setCalls([]); } })
      .finally(() => { if (!annule) setLoading(false); });
    return () => { annule = true; };
  }, [dealId]);

  useEffect(() => charger(mois), [charger, mois, refreshKey]);

  // Appels du mois regroupés par jour, du plus ancien au plus récent dans la
  // journée : la colonne se lit dans l'ordre où les appels ont été passés.
  const parJour = useMemo(() => {
    const map = new Map<string, DealCall[]>();
    for (const c of calls) {
      const k = jourDe(new Date(c.calledAt));
      const liste = map.get(k);
      if (liste) liste.push(c); else map.set(k, [c]);
    }
    for (const liste of Array.from(map.values())) {
      liste.sort((a, b) => a.calledAt.localeCompare(b.calledAt));
    }
    return map;
  }, [calls]);

  const cases = useMemo(() => casesDuMois(mois), [mois]);
  const aujourdhui = jourDe(new Date());

  const libelleMois = useMemo(() => {
    const [y, m] = mois.split('-').map(Number);
    return majuscule(new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }));
  }, [mois]);

  // Compteurs du mois, par couleur : le résumé qu'on vient chercher avant de
  // décider quand rappeler.
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

  const btnNav: React.CSSProperties = {
    padding: '5px 11px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff',
    cursor: 'pointer', fontSize: 12.5, color: '#334155', fontWeight: 600,
  };

  const detail = jourOuvert ? parJour.get(jourOuvert) ?? [] : [];

  return (
    <>
      {/* Navigation entre mois */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => { setMois(m => moisDecale(m, -1)); setJourOuvert(null); }} style={btnNav}>← Mois précédent</button>
        <button type="button" onClick={() => { setMois(moisDe(new Date())); setJourOuvert(null); }} style={{ ...btnNav, background: '#f8fafc' }}>Ce mois-ci</button>
        <button type="button" onClick={() => { setMois(m => moisDecale(m, 1)); setJourOuvert(null); }} style={btnNav}>Mois suivant →</button>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginLeft: 6 }}>{libelleMois}</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          {loading ? 'Chargement…' : `${calls.length} appel${calls.length > 1 ? 's' : ''}`}
        </span>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 13px', fontSize: 12.5, color: '#b91c1c', marginBottom: 12 }}>
          Impossible de charger les appels de ce mois.
        </div>
      )}

      {/* Grille du mois */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          {JOURS.map(j => (
            <div key={j} style={{ padding: '7px 6px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '.3px' }}>{j}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {cases.map(({ date, key, horsMois }) => {
            const duJour = parJour.get(key) ?? [];
            const estAujourdhui = key === aujourdhui;
            const ouvert = jourOuvert === key;
            return (
              <div
                key={key}
                onClick={() => duJour.length > 0 && setJourOuvert(ouvert ? null : key)}
                style={{
                  minHeight: 78, borderRight: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9',
                  padding: '5px 5px 6px', display: 'flex', flexDirection: 'column', gap: 3,
                  background: ouvert ? '#eef2ff' : horsMois ? '#fafbfc' : '#fff',
                  cursor: duJour.length > 0 ? 'pointer' : 'default',
                  outline: ouvert ? '2px solid #c7d2fe' : 'none', outlineOffset: -2,
                }}
              >
                <div style={{
                  fontSize: 11.5, fontWeight: estAujourdhui ? 800 : 600, textAlign: 'right',
                  color: horsMois ? '#cbd5e1' : estAujourdhui ? '#4338ca' : '#64748b',
                }}>
                  {estAujourdhui ? `• ${date.getDate()}` : date.getDate()}
                </div>
                {/* Au-delà de 3 appels dans la journée, on résume : le détail
                    complet s'ouvre au clic, sous la grille. */}
                {duJour.slice(0, 3).map(c => {
                  const st = callOutcomeStyle(c.outcome, c.connected);
                  return (
                    <div
                      key={c.id}
                      title={`${heure(c.calledAt)} — ${st.label}${c.userName ? ` · ${c.userName}` : ''}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, borderRadius: 4,
                        padding: '1px 4px', background: st.bg, border: `1px solid ${st.border}`,
                        color: st.text, fontSize: 10, fontWeight: 700, lineHeight: 1.5,
                        whiteSpace: 'nowrap', overflow: 'hidden',
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.dot, flexShrink: 0 }} />
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{heure(c.calledAt)}</span>
                    </div>
                  );
                })}
                {duJour.length > 3 && (
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6366f1' }}>+{duJour.length - 3} autre{duJour.length - 3 > 1 ? 's' : ''}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Légende + compteurs du mois */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 11.5, color: '#64748b' }}>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#16a34a', marginRight: 5 }} />Décisionnaire joint ({resume.joint})</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#dc2626', marginRight: 5 }} />Pas sur le magasin ({resume.absent})</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#ea580c', marginRight: 5 }} />En réunion / refus ({resume.indispo})</span>
        {resume.sansReponse > 0 && (
          <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#94a3b8', marginRight: 5 }} />Sans réponse ({resume.sansReponse})</span>
        )}
      </div>

      {/* Détail du jour cliqué */}
      {jourOuvert && detail.length > 0 && (
        <div style={{ marginTop: 16, border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
              {majuscule(new Date(`${jourOuvert}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))}
            </span>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{detail.length} appel{detail.length > 1 ? 's' : ''}</span>
            <button type="button" onClick={() => setJourOuvert(null)}
              style={{ marginLeft: 'auto', border: 'none', background: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {detail.map(c => {
              const st = callOutcomeStyle(c.outcome, c.connected);
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: st.bg, border: `1px solid ${st.border}`, borderRadius: 8, padding: '7px 11px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: st.dot, flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: st.text, fontVariantNumeric: 'tabular-nums' }}>{heure(c.calledAt)}</span>
                  <span style={{ fontSize: 12.5, color: st.text }}>{st.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {[c.userName, c.phone].filter(Boolean).join(' · ')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !error && calls.length === 0 && (
        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 14 }}>
          Aucun appel ce mois-ci. Chaque clic sur « Afficher le numéro » dans la fiche s&apos;inscrit ici.
        </p>
      )}
    </>
  );
}
