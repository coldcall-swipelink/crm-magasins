'use client';
// src/components/settings/PaymentFollowUpPanel.tsx
//
// Paramétrage de la relance « lien de paiement » : le mail proposé quand une
// affaire reste dans « LIEN PAIEMENT ENVOYÉ » sans bouger pendant le délai
// fixé ici. Ce mail n'est jamais envoyé automatiquement : il est proposé le
// matin à Hugo Abdelhadi et Bilal Yacouti, qui valident (ou non).
import { useCallback, useEffect, useState } from 'react';
import RichTextEditor from '@/components/ui/RichTextEditor';
import { toast } from '@/components/ui/Toast';
import { EMAIL_SENDERS } from '@/lib/emailSenders';

const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: 13, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnDef: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 13 };

interface Settings {
  subject: string;
  body: string;
  from: string;
  delayDays: number;
  variables: string[];
  defaults: { subject: string; body: string };
}

export default function PaymentFollowUpPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/payment-followups/settings');
      if (res.ok) setSettings(await res.json());
    } catch { /* la section reste simplement vide */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/payment-followups/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: settings.subject,
          body: settings.body,
          from: settings.from,
          delayDays: settings.delayDays,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Erreur');
      setSettings(s => (s ? { ...s, ...data } : s));
      toast('✓ Relance « lien de paiement » enregistrée');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Échec de l\'enregistrement', 'error');
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings(s => (s ? { ...s, [key]: value } : s));

  if (!settings) return null;

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Relance « lien de paiement »</div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10, lineHeight: 1.5 }}>
        Quand une affaire déposée dans <b>LIEN PAIEMENT ENVOYÉ</b> n&apos;a pas bougé au bout du délai ci-dessous,
        ce mail est <b>proposé</b> le matin à Hugo Abdelhadi et Bilal Yacouti. Rien ne part sans validation :
        chacun voit la file, et les décisions déjà prises par l&apos;autre.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Expéditeur</label>
          <select style={{ ...inp, cursor: 'pointer' }} value={settings.from} onChange={e => set('from', e.target.value)}>
            {EMAIL_SENDERS.map(s => <option key={s.email} value={s.email}>{s.label} — {s.email}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Délai avant relance (jours)</label>
          <input
            type="number"
            min={1}
            style={inp}
            value={settings.delayDays}
            onChange={e => set('delayDays', Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Sujet</label>
        <input style={inp} value={settings.subject} onChange={e => set('subject', e.target.value)} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Corps du message</label>
        <RichTextEditor
          value={settings.body}
          onChange={html => set('body', html)}
          variables={settings.variables}
          minHeight={180}
        />
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
          Cliquez une variable pour l&apos;insérer au curseur ; elle sera remplacée à l&apos;envoi.
          La signature de l&apos;expéditeur est ajoutée automatiquement.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          style={{ ...btnPri, opacity: saving ? 0.7 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}
          onClick={save}
          disabled={saving}
        >
          {saving ? '⟳ Enregistrement…' : 'Enregistrer la relance'}
        </button>
        <button
          style={btnDef}
          onClick={() => setSettings(s => (s ? { ...s, subject: s.defaults.subject, body: s.defaults.body } : s))}
        >
          ↺ Message par défaut
        </button>
      </div>
    </div>
  );
}
