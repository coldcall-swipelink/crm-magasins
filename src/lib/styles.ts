// src/lib/styles.ts — Design system partagé, zero Tailwind

export const colors = {
  primary: '#4f46e5',
  primaryHover: '#4338ca',
  primaryLight: '#eef2ff',
  border: '#e2e8f0',
  borderLight: '#f1f5f9',
  bg: '#f8fafc',
  bgWhite: '#fff',
  bgSecondary: '#f1f5f9',
  text: '#0f172a',
  textSecondary: '#475569',
  textTertiary: '#94a3b8',
  success: '#16a34a',
  successLight: '#dcfce7',
  error: '#dc2626',
  errorLight: '#fee2e2',
  warning: '#d97706',
  warningLight: '#fef3c7',
};

export const S = {
  // Layout
  app: { display: 'flex', height: '100vh', overflow: 'hidden' } as React.CSSProperties,
  sidebar: { width: 192, flexShrink: 0, background: '#fff', borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' as const, height: '100vh', position: 'sticky' as const, top: 0 },
  main: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  content: { flex: 1, overflow: 'auto' },

  // Nav
  navBtn: (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 10px', borderRadius: 7, border: 'none',
    width: '100%', textAlign: 'left', fontSize: 13,
    fontWeight: active ? 600 : 400, cursor: 'pointer',
    background: active ? '#eef2ff' : 'transparent',
    color: active ? '#4338ca' : '#475569',
    marginBottom: 1,
  }),

  // Buttons
  btnPrimary: { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 } as React.CSSProperties,
  btnDefault: { padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 } as React.CSSProperties,
  btnDanger: { padding: '7px 14px', borderRadius: 7, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontWeight: 500, cursor: 'pointer', fontSize: 13 } as React.CSSProperties,
  btnSm: { padding: '4px 10px', fontSize: 12 } as React.CSSProperties,
  btnXs: { padding: '2px 7px', fontSize: 11 } as React.CSSProperties,

  // Form
  inp: { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: 13, outline: 'none' } as React.CSSProperties,

  // Cards
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', cursor: 'pointer' } as React.CSSProperties,

  // Page
  pageHeader: { padding: '10px 20px', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 } as React.CSSProperties,
  pageTitle: { fontSize: 16, fontWeight: 700 } as React.CSSProperties,
  pageBody: { padding: '20px 24px' } as React.CSSProperties,

  // Metrics
  metric: (accent = false): React.CSSProperties => ({
    background: accent ? '#eef2ff' : '#fff',
    border: `1px solid ${accent ? '#c7d2fe' : '#e2e8f0'}`,
    borderRadius: 10, padding: '14px 16px',
  }),

  // Kanban
  col: { background: '#f1f5f9', borderRadius: 10, minWidth: 220, maxWidth: 230, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, border: '1px solid #e2e8f0' } as React.CSSProperties,

  // Panel
  panel: { width: 480, height: '100%', background: '#fff', borderLeft: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' } as React.CSSProperties,
  panelTab: (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '9px 4px', fontSize: 12, border: 'none',
    background: 'transparent', cursor: 'pointer',
    borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
    color: active ? '#4338ca' : '#64748b',
    fontWeight: active ? 600 : 400,
  }),

  // Alerts
  alertInfo: { background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#3730a3', display: 'flex', gap: 8, alignItems: 'flex-start' } as React.CSSProperties,
  alertWarn: { background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#78350f' } as React.CSSProperties,
  alertSuccess: { background: '#14532d', border: '1px solid #16a34a', borderRadius: 10, padding: 18, color: '#86efac' } as React.CSSProperties,

  // Badge
  badge: (color: string, bg: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', padding: '1px 5px',
    borderRadius: 3, fontSize: 10, fontWeight: 500,
    color, background: bg, whiteSpace: 'nowrap',
  }),

  // Section label
  sectionLabel: { fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '.8px', textTransform: 'uppercase' as const, margin: '14px 0 7px' } as React.CSSProperties,
  rowInfo: { display: 'flex', gap: 8, fontSize: 12, marginBottom: 5 } as React.CSSProperties,
};

export default S;
