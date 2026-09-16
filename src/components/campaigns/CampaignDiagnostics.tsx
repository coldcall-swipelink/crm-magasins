'use client';
// src/components/campaigns/CampaignDiagnostics.tsx
//
// « Pourquoi ça n'envoie pas ? », répondu par le système.
//
// Une campagne peut rester muette pour une dizaine de raisons légitimes :
// jamais lancée, hors plage horaire, quota atteint, boîte en panne,
// planificateur à l'arrêt. Aucune n'était visible — l'écran affichait
// « 0 envoyé » et laissait chercher. Ce panneau passe tous les verrous en
// revue et dit lequel est fermé.

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { btnDef, btnPri, card } from './ui';

type Check = { key: string; label: string; level: 'ok' | 'warn' | 'error'; detail: string };

const LEVELS = {
  ok:    { color: '#4ade80', mark: '●' },
  warn:  { color: '#fbbf24', mark: '●' },
  error: { color: '#f87171', mark: '●' },
} as const;

export default function CampaignDiagnostics({ campaignId, onSent }: {
  campaignId: string;
  onSent: () => void;
}) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [ok, setOk] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await fetch(`/api/campaigns/${campaignId}/diagnostics`).then(res => res.json());
    if (data.error) return;
    setChecks(data.checks);
    setOk(data.ok);
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  /** Déclenche un passage du moteur sans attendre le planificateur. */
  const sendNow = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/send-now`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Envoi impossible', 'error'); return; }

      if (data.sent > 0) toast(`${data.sent} email(s) parti(s)`);
      else if (data.skipped?.length) {
        // Le compte rendu du moteur dit pourquoi rien n'est parti : on le
        // montre tel quel plutôt qu'un « aucun envoi » sans explication.
        toast(`Aucun envoi : ${data.skipped.map((s: { mailbox: string; reason: string }) => `${s.mailbox} — ${s.reason}`).join(' · ')}`, 'error');
      } else if (data.failed > 0) {
        toast(`Échec : ${data.errors?.[0]?.message?.slice(0, 160) || 'voir le journal'}`, 'error');
      } else {
        toast('Aucun email en attente d\'envoi');
      }
      await load();
      onSent();
    } finally {
      setBusy(false);
    }
  };

  if (!checks) return null;

  return (
    <div style={{ ...card, marginBottom: 14, borderColor: ok ? '#262b38' : 'rgba(239,68,68,.35)', background: ok ? '#171a23' : '#fffbfb' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          {ok ? 'État des envois' : 'Les envois sont bloqués'}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button style={btnDef} onClick={load}>Actualiser</button>
          <button style={{ ...btnPri, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={sendNow}>
            {busy ? 'Envoi en cours…' : 'Envoyer maintenant'}
          </button>
        </div>
      </div>

      {checks.map(check => (
        <div key={check.key} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '5px 0', fontSize: 12.5 }}>
          <span style={{ color: LEVELS[check.level].color, lineHeight: 1.5 }}>{LEVELS[check.level].mark}</span>
          <div style={{ minWidth: 118, fontWeight: 500, color: '#cdd2df' }}>{check.label}</div>
          <div style={{ flex: 1, color: check.level === 'ok' ? '#9aa1b4' : '#cdd2df' }}>{check.detail}</div>
        </div>
      ))}

      <div style={{ fontSize: 11, color: '#6b7283', marginTop: 10, lineHeight: 1.6 }}>
        « Envoyer maintenant » fait tourner le moteur sur les boîtes de cette campagne, sans
        attendre le planificateur — mais avec les mêmes garde-fous : plage horaire, quota du
        jour et espacement entre deux emails sont respectés.
      </div>
    </div>
  );
}
