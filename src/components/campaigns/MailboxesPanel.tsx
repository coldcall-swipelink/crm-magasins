'use client';
// src/components/campaigns/MailboxesPanel.tsx
//
// Écran « Boîtes d'envoi » de l'onglet Campagnes : ajouter une adresse
// expéditrice, tester sa connexion et régler ses garde-fous d'envoi.
//
// Le mot de passe ne revient jamais du serveur : le champ reste vide à
// l'édition, et n'est transmis que si l'utilisateur en saisit un nouveau.

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/components/ui/Toast';

const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: 13, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnDef: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnXs: React.CSSProperties = { padding: '4px 9px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', cursor: 'pointer', fontSize: 11.5 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 };

export interface Mailbox {
  id: string; email: string; displayName: string; provider: string;
  smtpHost: string; smtpPort: number; smtpSecure: boolean; smtpUser: string;
  imapHost: string | null; imapPort: number; imapUser: string | null; imapFolder: string;
  dailyLimit: number; minDelaySec: number; maxDelaySec: number;
  sendStartHour: number; sendEndHour: number; sendDays: string; timezone: string;
  warmupStart: number; warmupStep: number;
  signatureHtml: string | null; active: boolean;
  lastCheckAt: string | null; lastCheckOk: boolean | null; lastError: string | null;
  imapConfigured: boolean; hasImapSecret: boolean;
}

type Preset = { label: string; smtpHost: string; smtpPort: number; smtpSecure: boolean; imapHost: string; imapPort: number; hint: string };

const DAYS = [
  { value: 1, label: 'L' }, { value: 2, label: 'M' }, { value: 3, label: 'M' },
  { value: 4, label: 'J' }, { value: 5, label: 'V' }, { value: 6, label: 'S' }, { value: 7, label: 'D' },
];

const EMPTY_FORM = {
  email: '', displayName: '', provider: 'google', password: '',
  smtpHost: '', smtpPort: 465, smtpSecure: true, smtpUser: '',
  imapHost: '', imapPort: 993, imapUser: '', imapPassword: '', imapFolder: 'INBOX',
  dailyLimit: 80, minDelaySec: 90, maxDelaySec: 300,
  sendStartHour: 8, sendEndHour: 19, sendDays: '1,2,3,4,5',
};

export default function MailboxesPanel() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [presets, setPresets] = useState<Record<string, Preset>>({});
  const [encryptionReady, setEncryptionReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/campaigns/mailboxes');
      const data = await res.json();
      setMailboxes(data.mailboxes || []);
      setPresets(data.presets || {});
      setEncryptionReady(Boolean(data.encryptionReady));
    } catch {
      toast('Chargement des boîtes impossible', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Changer de fournisseur pré-remplit les serveurs, sans écraser une saisie
  // manuelle déjà faite sur un réglage personnalisé.
  const pickProvider = (provider: string) => {
    const preset = presets[provider];
    setForm(f => ({
      ...f, provider,
      smtpHost: preset?.smtpHost ?? '', smtpPort: preset?.smtpPort ?? 465,
      smtpSecure: preset?.smtpSecure ?? true,
      imapHost: preset?.imapHost ?? '', imapPort: preset?.imapPort ?? 993,
    }));
  };

  const submit = async () => {
    if (!form.email.trim() || !form.password) {
      toast('Adresse et mot de passe requis', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/campaigns/mailboxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, smtpUser: form.smtpUser || form.email, imapUser: form.imapUser || form.email }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Échec de l\'enregistrement', 'error'); return; }
      toast(`Boîte ${form.email} connectée`);
      if (data.check?.imap && !data.check.imap.ok) {
        toast('SMTP validé, mais IMAP en échec : l\'arrêt sur réponse ne fonctionnera pas.', 'error');
      }
      setForm({ ...EMPTY_FORM });
      setAdding(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const test = async (mailbox: Mailbox, sendTo?: string) => {
    setTesting(mailbox.id);
    try {
      const res = await fetch(`/api/campaigns/mailboxes/${mailbox.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sendTo ? { sendTo } : {}),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Test impossible', 'error'); return; }
      const smtpOk = data.check?.smtp?.ok;
      if (!smtpOk) toast(`SMTP : ${data.check?.smtp?.error || 'échec'}`, 'error');
      else if (data.sent && !data.sent.ok) toast(`Envoi refusé : ${data.sent.error}`, 'error');
      else if (data.sent?.ok) toast(`Email de test envoyé à ${sendTo}`);
      else if (data.check?.imap && !data.check.imap.ok) toast(`SMTP ✓ · IMAP : ${data.check.imap.error}`, 'error');
      else toast('Connexion validée');
      load();
    } finally {
      setTesting(null);
    }
  };

  const patch = async (id: string, data: Record<string, unknown>) => {
    const res = await fetch(`/api/campaigns/mailboxes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) { toast('Modification refusée', 'error'); return; }
    load();
  };

  const remove = async (mailbox: Mailbox) => {
    if (!confirm(`Supprimer la boîte ${mailbox.email} ? Les campagnes qui l'utilisent devront être réaffectées.`)) return;
    const res = await fetch(`/api/campaigns/mailboxes/${mailbox.id}`, { method: 'DELETE' });
    if (!res.ok) { toast('Suppression impossible', 'error'); return; }
    toast('Boîte supprimée');
    load();
  };

  const set = (key: string, value: unknown) => setForm(f => ({ ...f, [key]: value }));
  const hint = presets[form.provider]?.hint;

  return (
    <div style={{ padding: '18px 24px', maxWidth: 1000 }}>
      {!encryptionReady && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 14px', fontSize: 12.5, color: '#78350f', marginBottom: 16 }}>
          <strong>Clé de chiffrement manquante.</strong> Les mots de passe des boîtes sont chiffrés en base :
          générez une clé avec <code>openssl rand -hex 32</code> et ajoutez-la en variable d&apos;environnement
          <code> CAMPAIGN_SECRET_KEY</code>. Tant qu&apos;elle est absente, aucune boîte ne peut être enregistrée.
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Boîtes d&apos;envoi</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            Les campagnes partent de ces adresses, en direct (SMTP), et leurs réponses sont relevées en IMAP.
          </div>
        </div>
        {!adding && (
          <button style={btnPri} onClick={() => { setForm({ ...EMPTY_FORM }); setAdding(true); pickProvider('google'); }}>
            + Connecter une boîte
          </button>
        )}
      </div>

      {adding && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18, marginBottom: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={label}>Fournisseur</label>
              <select style={inp} value={form.provider} onChange={e => pickProvider(e.target.value)}>
                {Object.entries(presets).map(([key, preset]) => (
                  <option key={key} value={key}>{preset.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={label}>Adresse email</label>
              <input style={inp} placeholder="bilal@swipelink.fr" value={form.email}
                onChange={e => set('email', e.target.value)} />
            </div>
            <div>
              <label style={label}>Nom affiché</label>
              <input style={inp} placeholder="Bilal Yacouti - Swipelink" value={form.displayName}
                onChange={e => set('displayName', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 6 }}>
            <div>
              <label style={label}>Mot de passe</label>
              <input style={inp} type="password" autoComplete="new-password" value={form.password}
                onChange={e => set('password', e.target.value)} />
            </div>
            <div style={{ fontSize: 11.5, color: '#64748b', alignSelf: 'end', paddingBottom: 8 }}>{hint}</div>
          </div>

          <PasswordHelp provider={form.provider} />

          <details style={{ marginTop: 10 }}>
            <summary style={{ fontSize: 12, color: '#4f46e5', cursor: 'pointer' }}>Réglages serveurs et cadence</summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 12 }}>
              <div><label style={label}>Serveur SMTP</label>
                <input style={inp} value={form.smtpHost} onChange={e => set('smtpHost', e.target.value)} /></div>
              <div><label style={label}>Port SMTP</label>
                <input style={inp} type="number" value={form.smtpPort} onChange={e => set('smtpPort', Number(e.target.value))} /></div>
              <div><label style={label}>Serveur IMAP</label>
                <input style={inp} value={form.imapHost} onChange={e => set('imapHost', e.target.value)} /></div>
              <div><label style={label}>Port IMAP</label>
                <input style={inp} type="number" value={form.imapPort} onChange={e => set('imapPort', Number(e.target.value))} /></div>
              <div><label style={label}>Envois / jour</label>
                <input style={inp} type="number" value={form.dailyLimit} onChange={e => set('dailyLimit', Number(e.target.value))} /></div>
              <div><label style={label}>Délai min. (s)</label>
                <input style={inp} type="number" value={form.minDelaySec} onChange={e => set('minDelaySec', Number(e.target.value))} /></div>
              <div><label style={label}>Délai max. (s)</label>
                <input style={inp} type="number" value={form.maxDelaySec} onChange={e => set('maxDelaySec', Number(e.target.value))} /></div>
              <div><label style={label}>Plage horaire</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input style={inp} type="number" value={form.sendStartHour} onChange={e => set('sendStartHour', Number(e.target.value))} />
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>→</span>
                  <input style={inp} type="number" value={form.sendEndHour} onChange={e => set('sendEndHour', Number(e.target.value))} />
                </div></div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={label}>Jours d&apos;envoi</label>
              <DayPicker value={form.sendDays} onChange={v => set('sendDays', v)} />
            </div>
          </details>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button style={{ ...btnPri, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={submit}>
              {saving ? 'Test de connexion…' : 'Tester et enregistrer'}
            </button>
            <button style={btnDef} onClick={() => setAdding(false)}>Annuler</button>
          </div>
          <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 8 }}>
            La boîte n&apos;est enregistrée que si la connexion aboutit.
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: '#94a3b8' }}>Chargement…</div>
      ) : mailboxes.length === 0 ? (
        <div style={{ background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 12, padding: 28, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          Aucune boîte connectée. Connectez au moins une adresse pour pouvoir lancer une campagne.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mailboxes.map(mailbox => (
            <MailboxCard
              key={mailbox.id}
              mailbox={mailbox}
              busy={testing === mailbox.id}
              expanded={editing === mailbox.id}
              onToggleExpand={() => setEditing(editing === mailbox.id ? null : mailbox.id)}
              onTest={test}
              onPatch={patch}
              onRemove={remove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Marche à suivre pour obtenir le mot de passe, par fournisseur.
 *
 * Ce n'est pas du détail : chez Google, le mot de passe habituel du compte est
 * systématiquement refusé en SMTP, et rien dans le message d'erreur ne dit
 * pourquoi. Autant l'expliquer là où la question se pose.
 */
function PasswordHelp({ provider }: { provider: string }) {
  if (provider === 'google') {
    return (
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9, padding: '11px 14px', fontSize: 12, color: '#475569', lineHeight: 1.6, marginBottom: 6 }}>
        <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 5 }}>
          Où trouver ce mot de passe ?
        </div>
        Google refuse le mot de passe habituel du compte pour une connexion SMTP : il faut un
        « mot de passe d&apos;application », un code de 16 caractères dédié.
        <ol style={{ margin: '7px 0 0', paddingLeft: 18 }}>
          <li>Activer la <strong>validation en deux étapes</strong> sur ce compte (sans elle, la page
            suivante n&apos;existe pas).</li>
          <li>Connecté avec cette adresse, ouvrir{' '}
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer"
              style={{ color: '#4f46e5' }}>myaccount.google.com/apppasswords</a>,
            nommer l&apos;application (« CRM ») et copier les 16 caractères affichés.</li>
          <li>Vérifier que l&apos;IMAP est activé : Gmail → Paramètres → Transfert et POP/IMAP →
            « Activer IMAP » (sans quoi les réponses ne seront pas relevées).</li>
        </ol>
        <div style={{ marginTop: 6, color: '#64748b' }}>
          Les espaces entre les blocs n&apos;ont pas d&apos;importance, ils sont retirés à
          l&apos;enregistrement. Si la page des mots de passe d&apos;application est inaccessible,
          c&apos;est que l&apos;administrateur Workspace les a désactivés, ou que le compte est en
          « Protection avancée ».
        </div>
      </div>
    );
  }

  if (provider === 'ovh') {
    return (
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9, padding: '11px 14px', fontSize: 12, color: '#475569', lineHeight: 1.6, marginBottom: 6 }}>
        <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 5 }}>
          Où trouver ce mot de passe ?
        </div>
        C&apos;est le mot de passe de la boîte elle-même, celui qui ouvre le webmail OVH : rien à
        générer. Si vous ne l&apos;avez plus, redéfinissez-le dans l&apos;espace client OVH →
        Web Cloud → Emails → votre domaine → Comptes e-mail → l&apos;adresse → Modifier le mot de
        passe.
      </div>
    );
  }

  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9, padding: '11px 14px', fontSize: 12, color: '#475569', lineHeight: 1.6, marginBottom: 6 }}>
      Le mot de passe de la boîte chez votre hébergeur, et ses serveurs SMTP et IMAP
      (« Réglages serveurs » ci-dessous). Si l&apos;hébergeur impose un mot de passe dédié aux
      applications, c&apos;est celui-là qu&apos;il faut.
    </div>
  );
}

/** Sélecteur de jours d'envoi : « 1,2,3,4,5 » manipulé par clics. */
function DayPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = new Set(value.split(',').map(Number).filter(Boolean));
  const toggle = (day: number) => {
    const next = new Set(selected);
    if (next.has(day)) next.delete(day); else next.add(day);
    onChange(Array.from(next).sort((a, b) => a - b).join(','));
  };
  return (
    <div style={{ display: 'flex', gap: 5 }}>
      {DAYS.map(day => {
        const on = selected.has(day.value);
        return (
          <button key={day.value} onClick={() => toggle(day.value)} style={{
            width: 32, height: 30, borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            border: `1px solid ${on ? '#4f46e5' : '#e2e8f0'}`,
            background: on ? '#eef2ff' : '#f8fafc', color: on ? '#4338ca' : '#94a3b8',
          }}>{day.label}</button>
        );
      })}
    </div>
  );
}

function MailboxCard({ mailbox, busy, expanded, onToggleExpand, onTest, onPatch, onRemove }: {
  mailbox: Mailbox;
  busy: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onTest: (mailbox: Mailbox, sendTo?: string) => void;
  onPatch: (id: string, data: Record<string, unknown>) => void;
  onRemove: (mailbox: Mailbox) => void;
}) {
  const [testTo, setTestTo] = useState('');
  const [password, setPassword] = useState('');
  const [draft, setDraft] = useState({
    displayName: mailbox.displayName, dailyLimit: mailbox.dailyLimit,
    minDelaySec: mailbox.minDelaySec, maxDelaySec: mailbox.maxDelaySec,
    sendStartHour: mailbox.sendStartHour, sendEndHour: mailbox.sendEndHour,
    sendDays: mailbox.sendDays, signatureHtml: mailbox.signatureHtml || '',
  });

  const status = mailbox.lastCheckOk === null ? { text: 'Non testée', color: '#94a3b8', bg: '#f1f5f9' }
    : mailbox.lastCheckOk ? { text: 'Opérationnelle', color: '#15803d', bg: '#dcfce7' }
    : { text: 'En échec', color: '#b91c1c', bg: '#fee2e2' };

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', opacity: mailbox.active ? 1 : 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{mailbox.email}</span>
            <span style={{ padding: '1px 7px', borderRadius: 4, fontSize: 10.5, fontWeight: 600, color: status.color, background: status.bg }}>
              {status.text}
            </span>
            {!mailbox.imapConfigured && (
              <span style={{ padding: '1px 7px', borderRadius: 4, fontSize: 10.5, fontWeight: 600, color: '#78350f', background: '#fef3c7' }}>
                sans IMAP
              </span>
            )}
            {!mailbox.active && (
              <span style={{ padding: '1px 7px', borderRadius: 4, fontSize: 10.5, color: '#475569', background: '#f1f5f9' }}>en pause</span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 3 }}>
            {mailbox.displayName || 'Sans nom affiché'} · {mailbox.dailyLimit} envois/j ·
            {' '}{mailbox.sendStartHour}h–{mailbox.sendEndHour}h ·
            {' '}délai {mailbox.minDelaySec}–{mailbox.maxDelaySec}s
          </div>
          {mailbox.lastError && (
            <div style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 4 }}>{mailbox.lastError}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button style={btnXs} disabled={busy} onClick={() => onTest(mailbox)}>
            {busy ? '…' : 'Tester'}
          </button>
          <button style={btnXs} onClick={() => onPatch(mailbox.id, { active: !mailbox.active })}>
            {mailbox.active ? 'Mettre en pause' : 'Réactiver'}
          </button>
          <button style={btnXs} onClick={onToggleExpand}>{expanded ? 'Fermer' : 'Régler'}</button>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid #f1f5f9', marginTop: 14, paddingTop: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <div><label style={label}>Nom affiché</label>
              <input style={inp} value={draft.displayName} onChange={e => setDraft({ ...draft, displayName: e.target.value })} /></div>
            <div><label style={label}>Envois / jour</label>
              <input style={inp} type="number" value={draft.dailyLimit} onChange={e => setDraft({ ...draft, dailyLimit: Number(e.target.value) })} /></div>
            <div><label style={label}>Délai min. (s)</label>
              <input style={inp} type="number" value={draft.minDelaySec} onChange={e => setDraft({ ...draft, minDelaySec: Number(e.target.value) })} /></div>
            <div><label style={label}>Délai max. (s)</label>
              <input style={inp} type="number" value={draft.maxDelaySec} onChange={e => setDraft({ ...draft, maxDelaySec: Number(e.target.value) })} /></div>
            <div><label style={label}>Début (h)</label>
              <input style={inp} type="number" value={draft.sendStartHour} onChange={e => setDraft({ ...draft, sendStartHour: Number(e.target.value) })} /></div>
            <div><label style={label}>Fin (h)</label>
              <input style={inp} type="number" value={draft.sendEndHour} onChange={e => setDraft({ ...draft, sendEndHour: Number(e.target.value) })} /></div>
            <div style={{ gridColumn: 'span 2' }}><label style={label}>Jours d&apos;envoi</label>
              <DayPicker value={draft.sendDays} onChange={v => setDraft({ ...draft, sendDays: v })} /></div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={label}>Signature HTML (ajoutée en bas des emails de cette boîte)</label>
            <textarea style={{ ...inp, minHeight: 70, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
              value={draft.signatureHtml} onChange={e => setDraft({ ...draft, signatureHtml: e.target.value })} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <div>
              <label style={label}>Nouveau mot de passe (laisser vide pour le conserver)</label>
              <input style={inp} type="password" autoComplete="new-password" value={password}
                onChange={e => setPassword(e.target.value)} />
            </div>
            <div>
              <label style={label}>Envoyer un email de test à</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input style={inp} placeholder="moi@exemple.fr" value={testTo} onChange={e => setTestTo(e.target.value)} />
                <button style={btnDef} disabled={busy || !testTo} onClick={() => onTest(mailbox, testTo)}>Envoyer</button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button style={btnPri} onClick={() => {
              onPatch(mailbox.id, { ...draft, ...(password ? { password } : {}) });
              setPassword('');
            }}>Enregistrer</button>
            <button style={{ ...btnDef, marginLeft: 'auto', borderColor: '#fecaca', background: '#fef2f2', color: '#b91c1c' }}
              onClick={() => onRemove(mailbox)}>Supprimer la boîte</button>
          </div>
        </div>
      )}
    </div>
  );
}
