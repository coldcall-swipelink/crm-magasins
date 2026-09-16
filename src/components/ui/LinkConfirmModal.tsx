'use client';
// src/components/ui/LinkConfirmModal.tsx
//
// « Cette modification touche aussi l'autre côté. »
//
// Un lead de prospection et l'affaire dont il vient décrivent le même contact :
// leurs champs partagés se répercutent dans les deux sens. Une répercussion
// silencieuse serait un piège — on corrige un nom dans une campagne, on modifie
// une fiche affaire sans l'avoir voulu. Cette fenêtre montre donc, avant
// d'écrire, exactement ce qui va changer de l'autre côté.
//
// Elle sert les deux écrans : la fiche affaire (thème clair) et la fiche lead
// (thème sombre de l'onglet Campagnes), d'où la palette en paramètre.

export type LinkImpact = {
  field: string;
  label: string;
  from: string;
  to: string;
  /** Renseigné quand la valeur ne PEUT pas être répercutée, avec la raison. */
  blocked?: string;
};

export type LinkPreview = {
  target: string;
  direction: 'toDeal' | 'toLead';
  impacts: LinkImpact[];
};

export default function LinkConfirmModal({ link, dark = false, busy = false, onConfirm, onCancel }: {
  link: LinkPreview;
  dark?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const c = dark
    ? { surface: '#171a23', border: '#262b38', text: '#e7e9ef', muted: '#9aa1b4', faint: '#6b7283',
        veil: 'rgba(5,7,12,.68)', primary: '#3b71f5', warnBg: 'rgba(245,158,11,.12)',
        warnBorder: 'rgba(245,158,11,.35)', warnText: '#fbbf24', old: '#6b7283' }
    : { surface: '#fff', border: '#e2e8f0', text: '#0f172a', muted: '#475569', faint: '#94a3b8',
        veil: 'rgba(15,23,42,.45)', primary: '#4f46e5', warnBg: '#fffbeb',
        warnBorder: '#fde68a', warnText: '#78350f', old: '#94a3b8' };

  const applicable = link.impacts.filter(impact => !impact.blocked);
  const blocked = link.impacts.filter(impact => impact.blocked);

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: c.veil, backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, padding: 24,
    }}>
      <div onClick={event => event.stopPropagation()} style={{
        background: c.surface, border: `1px solid ${c.border}`, borderRadius: 12,
        padding: 22, width: 'min(520px, 100%)', color: c.text,
        boxShadow: '0 24px 64px rgba(0,0,0,.35)',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
          Cette modification touche aussi {link.target}
        </div>
        <div style={{ fontSize: 12.5, color: c.muted, marginBottom: 16, lineHeight: 1.6 }}>
          {link.direction === 'toDeal'
            ? "Ce lead vient d'une affaire du CRM. Les champs de contact sont partagés entre les deux."
            : "Un lead de prospection vient de cette affaire. Les champs de contact sont partagés entre les deux."}
        </div>

        {applicable.length > 0 && (
          <div style={{ border: `1px solid ${c.border}`, borderRadius: 9, overflow: 'hidden', marginBottom: 12 }}>
            {applicable.map(impact => (
              <div key={impact.field} style={{ padding: '9px 13px', borderBottom: `1px solid ${c.border}`, fontSize: 12.5 }}>
                <div style={{ fontWeight: 600, marginBottom: 3 }}>{impact.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: c.old, textDecoration: 'line-through' }}>
                    {impact.from || 'vide'}
                  </span>
                  <span style={{ color: c.faint }}>→</span>
                  <span style={{ fontWeight: 600 }}>{impact.to || 'vide'}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {blocked.length > 0 && (
          <div style={{ background: c.warnBg, border: `1px solid ${c.warnBorder}`, borderRadius: 9, padding: '10px 13px', fontSize: 12, color: c.warnText, marginBottom: 12 }}>
            {blocked.map(impact => (
              <div key={impact.field} style={{ marginBottom: 3 }}>
                <strong>{impact.label}</strong> ne sera pas répercuté — {impact.blocked}.
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onConfirm} disabled={busy} style={{
            padding: '8px 15px', borderRadius: 8, border: 'none', background: c.primary,
            color: '#fff', fontWeight: 600, fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}>
            {busy ? 'Enregistrement…'
              : applicable.length > 0 ? 'Appliquer des deux côtés' : 'Enregistrer sans répercuter'}
          </button>
          <button onClick={onCancel} disabled={busy} style={{
            padding: '8px 15px', borderRadius: 8, border: `1px solid ${c.border}`,
            background: dark ? '#1c1f2a' : '#f1f5f9', color: c.text, fontWeight: 500,
            fontSize: 13, cursor: 'pointer',
          }}>Annuler</button>
        </div>
      </div>
    </div>
  );
}
