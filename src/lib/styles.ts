// src/lib/styles.ts — Design system partagé, zero Tailwind

// Palette inspirée de la charte Swipelink : violet/mauve + bleu en dégradé,
// fonds très clairs, surfaces d'emphase en indigo profond (sidebar/footer).
export const colors = {
  primary: '#6d5ae6',        // violet Swipelink
  primaryHover: '#5a47d4',
  primaryDark: '#3a2e8c',
  primaryLight: '#f1eefe',
  accent: '#4f6bff',         // bleu Swipelink (2e teinte du dégradé)
  gradient: 'linear-gradient(135deg,#7c5cff 0%,#4f6bff 100%)',
  gradientSoft: 'linear-gradient(135deg,#f1eefe 0%,#eaf0ff 100%)',
  // Sidebar / surfaces sombres (cf. mockup produit du site Swipelink)
  sidebarBg: '#171a3a',
  sidebarBgActive: 'rgba(124,108,240,.16)',
  sidebarBorder: 'rgba(255,255,255,.08)',
  sidebarText: '#b9bbd6',
  sidebarTextActive: '#fff',
  border: '#e9e9f1',
  borderLight: '#f1f1f7',
  bg: '#f7f7fb',
  bgWhite: '#fff',
  bgSecondary: '#f3f3f9',
  text: '#14152b',
  textSecondary: '#5b5e78',
  textTertiary: '#9a9cb5',
  success: '#16a34a',
  successLight: '#dcfce7',
  error: '#dc2626',
  errorLight: '#fee2e2',
  warning: '#d97706',
  warningLight: '#fef3c7',
  shadow: '0 1px 2px rgba(20,21,43,.04), 0 1px 3px rgba(20,21,43,.06)',
  shadowMd: '0 4px 16px rgba(20,21,43,.08)',
  shadowBtn: '0 4px 14px rgba(109,90,230,.35)',
};

export const S = {
  // Layout
  app: { display: 'flex', height: '100vh', overflow: 'hidden' } as React.CSSProperties,
  sidebar: { width: 204, flexShrink: 0, background: '#171a3a', borderRight: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column' as const, height: '100vh', position: 'sticky' as const, top: 0 },
  main: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  content: { flex: 1, overflow: 'auto' },

  // Nav
  navBtn: (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 10px', borderRadius: 9, border: 'none',
    width: '100%', textAlign: 'left', fontSize: 13,
    fontWeight: active ? 600 : 400, cursor: 'pointer',
    background: active ? '#f1eefe' : 'transparent',
    color: active ? '#5a47d4' : '#5b5e78',
    marginBottom: 1,
  }),

  // Buttons — primaire en dégradé violet→bleu (signature Swipelink)
  btnPrimary: { padding: '8px 15px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#7c5cff 0%,#4f6bff 100%)', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5, boxShadow: '0 4px 14px rgba(109,90,230,.35)' } as React.CSSProperties,
  btnDefault: { padding: '8px 15px', borderRadius: 9, border: '1px solid #e9e9f1', background: '#fff', color: '#3a3d57', fontWeight: 500, cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 } as React.CSSProperties,
  btnDanger: { padding: '8px 15px', borderRadius: 9, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontWeight: 500, cursor: 'pointer', fontSize: 13 } as React.CSSProperties,
  btnSm: { padding: '4px 10px', fontSize: 12 } as React.CSSProperties,
  btnXs: { padding: '2px 7px', fontSize: 11 } as React.CSSProperties,

  // Form
  inp: { width: '100%', padding: '8px 11px', borderRadius: 9, border: '1px solid #e9e9f1', background: '#f7f7fb', color: '#14152b', fontSize: 13, outline: 'none' } as React.CSSProperties,

  // Cards
  card: { background: '#fff', border: '1px solid #e9e9f1', borderRadius: 14, padding: '11px 13px', cursor: 'pointer', boxShadow: '0 1px 2px rgba(20,21,43,.04), 0 1px 3px rgba(20,21,43,.06)' } as React.CSSProperties,

  // Page
  pageHeader: { padding: '11px 20px', background: '#fff', borderBottom: '1px solid #e9e9f1', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 } as React.CSSProperties,
  pageTitle: { fontSize: 16, fontWeight: 700, letterSpacing: '-.01em' } as React.CSSProperties,
  pageBody: { padding: '20px 24px' } as React.CSSProperties,

  // Metrics
  metric: (accent = false): React.CSSProperties => ({
    background: accent ? '#f1eefe' : '#fff',
    border: `1px solid ${accent ? '#dad3f9' : '#e9e9f1'}`,
    borderRadius: 14, padding: '15px 17px',
    boxShadow: accent ? 'none' : '0 1px 2px rgba(20,21,43,.04), 0 1px 3px rgba(20,21,43,.06)',
  }),

  // Kanban
  col: { background: '#f3f3f9', borderRadius: 14, minWidth: 220, maxWidth: 230, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, border: '1px solid #e9e9f1' } as React.CSSProperties,

  // Panel
  panel: { width: 480, height: '100%', background: '#fff', borderLeft: '1px solid #e9e9f1', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' } as React.CSSProperties,
  panelTab: (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '9px 4px', fontSize: 12, border: 'none',
    background: 'transparent', cursor: 'pointer',
    borderBottom: active ? '2px solid #7c6bf0' : '2px solid transparent',
    color: active ? '#5a47d4' : '#6b6e89',
    fontWeight: active ? 600 : 400,
  }),

  // Alerts
  alertInfo: { background: '#f1eefe', border: '1px solid #dad3f9', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#3a2e8c', display: 'flex', gap: 8, alignItems: 'flex-start' } as React.CSSProperties,
  alertWarn: { background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#78350f' } as React.CSSProperties,
  alertSuccess: { background: '#14532d', border: '1px solid #16a34a', borderRadius: 10, padding: 18, color: '#86efac' } as React.CSSProperties,

  // Badge
  badge: (color: string, bg: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', padding: '1px 5px',
    borderRadius: 3, fontSize: 10, fontWeight: 500,
    color, background: bg, whiteSpace: 'nowrap',
  }),

  // Section label
  sectionLabel: { fontSize: 10, fontWeight: 700, color: '#9a9cb5', letterSpacing: '.8px', textTransform: 'uppercase' as const, margin: '14px 0 7px' } as React.CSSProperties,
  rowInfo: { display: 'flex', gap: 8, fontSize: 12, marginBottom: 5 } as React.CSSProperties,
};

export default S;
