'use client';
import { useCallback, useEffect, useState } from 'react';

/**
 * Pop-up « Afficher les dispos » : l'agenda Google de la semaine, en créneaux
 * de 30 minutes, pour caler une démo sans quitter la fiche affaire.
 *
 * Lecture seule côté agenda. Cliquer un créneau libre renseigne la date de
 * démo de l'affaire — c'est le geste qu'on vient chercher ici.
 */

interface Slot { start: string; end: string; label: string; busy: boolean; past: boolean; busyLabel?: string; }
interface Day { date: string; label: string; weekend: boolean; slots: Slot[]; }
interface Availability { configured: boolean; timeZone: string; weekStart: string; days: Day[]; error?: string; }

interface Props {
  /** Reçoit le début du créneau choisi (ISO). */
  onPick: (startIso: string) => void;
  onClose: () => void;
}

/** Lundi décalé de n semaines, au format « YYYY-MM-DD ». */
function semaineDecalee(weekStart: string, semaines: number): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + semaines * 7);
  return t.toISOString().slice(0, 10);
}

export default function AvailabilityModal({ onPick, onClose }: Props) {
  const [week, setWeek] = useState<string | undefined>(undefined);
  const [data, setData] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(true);

  const charger = useCallback((semaine?: string) => {
    setLoading(true);
    fetch(`/api/calendar/availability${semaine ? `?week=${semaine}` : ''}`)
      .then(r => r.json())
      .then((d: Availability) => { setData(d); setWeek(d.weekStart); })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { charger(); }, [charger]);

  // Échap referme, comme partout ailleurs dans le CRM.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const libelleSemaine = data
    ? `${data.days[0]?.label ?? ''} → ${data.days[6]?.label ?? ''}`
    : '';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 1100,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 14, width: 'min(1080px, 100%)', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', padding: '18px 22px 20px',
          boxShadow: '0 20px 60px rgba(15,23,42,.35)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 24 }}>📅</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Disponibilités</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              Créneaux de 30 minutes · cliquez pour caler la démo
              {data?.timeZone ? ` · ${data.timeZone}` : ''}
            </div>
          </div>
          <button onClick={onClose} title="Fermer" style={{ border: 'none', background: 'none', fontSize: 20, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Navigation entre semaines */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <button onClick={() => week && charger(semaineDecalee(week, -1))} disabled={loading}
            style={{ padding: '5px 11px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 13, color: '#334155' }}>
            ← Semaine précédente
          </button>
          <button onClick={() => charger()} disabled={loading}
            style={{ padding: '5px 11px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', fontSize: 13, color: '#334155' }}>
            Cette semaine
          </button>
          <button onClick={() => week && charger(semaineDecalee(week, 1))} disabled={loading}
            style={{ padding: '5px 11px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 13, color: '#334155' }}>
            Semaine suivante →
          </button>
          <span style={{ fontSize: 12.5, color: '#64748b', marginLeft: 4 }}>{loading ? 'Chargement…' : libelleSemaine}</span>
        </div>

        {data && !data.configured && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: '#78350f', marginBottom: 12 }}>
            Agenda Google non connecté : la grille est affichée vide. Renseignez GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET et GOOGLE_REFRESH_TOKEN pour voir vos occupations.
          </div>
        )}
        {data?.error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: '#b91c1c', marginBottom: 12 }}>
            Agenda illisible — les créneaux affichés ne tiennent pas compte de vos rendez-vous. {data.error}
          </div>
        )}

        {/* Grille : un jour par colonne, une demi-heure par ligne */}
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0, border: '1px solid #e2e8f0', borderRadius: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data?.days.length || 7}, minmax(122px, 1fr))`, minWidth: 860 }}>
            {(data?.days ?? []).map(day => (
              <div key={day.date} style={{ borderRight: '1px solid #f1f5f9' }}>
                <div style={{
                  position: 'sticky', top: 0, zIndex: 1, padding: '8px 6px', textAlign: 'center',
                  background: day.weekend ? '#f8fafc' : '#fff', borderBottom: '1px solid #e2e8f0',
                  fontSize: 12, fontWeight: 600, color: day.weekend ? '#94a3b8' : '#0f172a',
                  textTransform: 'capitalize',
                }}>
                  {day.label}
                </div>
                <div style={{ padding: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {day.slots.map(slot => {
                    const indisponible = slot.busy || slot.past;
                    return (
                      <button
                        key={slot.start}
                        disabled={indisponible}
                        onClick={() => onPick(slot.start)}
                        title={slot.past ? 'Créneau passé' : slot.busy ? `Occupé — ${slot.busyLabel || 'rendez-vous'}` : 'Libre — cliquez pour caler la démo'}
                        style={{
                          padding: '4px 6px', fontSize: 11.5, borderRadius: 5, textAlign: 'center',
                          fontVariantNumeric: 'tabular-nums',
                          cursor: indisponible ? 'default' : 'pointer',
                          border: `1px solid ${slot.busy ? '#fecaca' : slot.past ? '#f1f5f9' : '#bbf7d0'}`,
                          background: slot.busy ? '#fef2f2' : slot.past ? '#f8fafc' : '#f0fdf4',
                          color: slot.busy ? '#b91c1c' : slot.past ? '#cbd5e1' : '#166534',
                          fontWeight: indisponible ? 400 : 600,
                        }}
                      >
                        {slot.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, fontSize: 11.5, color: '#64748b' }}>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: '#f0fdf4', border: '1px solid #bbf7d0', marginRight: 5 }} />Libre</span>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: '#fef2f2', border: '1px solid #fecaca', marginRight: 5 }} />Occupé</span>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: '#f8fafc', border: '1px solid #f1f5f9', marginRight: 5 }} />Passé</span>
        </div>
      </div>
    </div>
  );
}
