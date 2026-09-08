'use client';
import { useProspectionMode } from '@/lib/prospectionMode';

// Interrupteur « Mode prospection », affiché en haut à droite de chaque écran.
// Vert = les clics sur « Afficher le numéro » comptent comme des appels ;
// gris = les numéros se dévoilent sans rien journaliser.
export default function ProspectionModeToggle() {
  const { enabled, ready, toggle } = useProspectionMode();
  const on = ready && enabled;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={toggle}
      disabled={!ready}
      title={on
        ? 'Mode prospection activé : chaque numéro affiché compte comme un appel. Cliquer pour désactiver.'
        : 'Mode prospection désactivé : les appels ne sont pas comptabilisés. Cliquer pour activer.'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        height: 30, padding: '0 10px 0 12px', borderRadius: 999,
        border: `1px solid ${on ? '#86efac' : '#e2e8f0'}`,
        background: on ? '#dcfce7' : '#f8fafc',
        color: on ? '#15803d' : '#64748b',
        fontSize: 12.5, fontWeight: 600, cursor: ready ? 'pointer' : 'default',
        fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'all .15s',
      }}
    >
      <span>📞 Mode prospection</span>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: .3 }}>{on ? 'ON' : 'OFF'}</span>
      {/* Pastille façon interrupteur */}
      <span style={{
        position: 'relative', width: 30, height: 16, borderRadius: 999, flexShrink: 0,
        background: on ? '#22c55e' : '#cbd5e1', transition: 'background .15s',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 16 : 2, width: 12, height: 12, borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 2px rgba(15,23,42,.25)', transition: 'left .15s',
        }} />
      </span>
    </button>
  );
}
