'use client';
// src/components/campaigns/CampaignsPanel.tsx
//
// Écran « Campagnes » : la liste des séquences, et l'ouverture de l'une
// d'elles. Chaque carte donne l'essentiel — état, volume envoyé, taux de
// réponse — pour repérer d'un coup d'œil celle qui travaille.

import { useCallback, useEffect, useState } from 'react';
import { useCurrentUser } from '@/lib/currentUser';
import { toast } from '@/components/ui/Toast';
import CampaignDetail from './CampaignDetail';
import { CAMPAIGN_STATUS, btnDef, btnPri, card, inp, label, modal, overlay } from './ui';

type CampaignRow = {
  id: string; name: string; description: string; status: string;
  sentCount: number; replyCount: number;
  _count: { enrollments: number; steps: number };
  mailboxes: Array<{ mailbox: { id: string; email: string; active: boolean } }>;
  createdAt: string;
};

export default function CampaignsPanel({ onGoToMailboxes }: { onGoToMailboxes: () => void }) {
  const { user } = useCurrentUser();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/campaigns');
      const data = await res.json();
      setCampaigns(data.campaigns || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (selected) {
    return <CampaignDetail campaignId={selected} onBack={() => setSelected(null)} onChanged={load} />;
  }

  return (
    <div style={{ padding: '18px 24px', maxWidth: 1000, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Séquences d&apos;emails</div>
          <div style={{ fontSize: 12, color: '#9aa1b4', marginTop: 2 }}>
            Une campagne enchaîne plusieurs emails espacés de délais d&apos;attente, et s&apos;arrête
            d&apos;elle-même pour tout lead qui répond.
          </div>
        </div>
        <button style={{ ...btnPri, marginLeft: 'auto' }} onClick={() => setCreating(true)}>+ Nouvelle campagne</button>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: '#6b7283' }}>Chargement…</div>
      ) : campaigns.length === 0 ? (
        <div style={{ background: '#171a23', border: '1px dashed #333a4a', borderRadius: 12, padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>Aucune campagne</div>
          <div style={{ fontSize: 12.5, color: '#9aa1b4', marginBottom: 14 }}>
            Il faut d&apos;abord une boîte d&apos;envoi connectée et des leads importés.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button style={btnPri} onClick={() => setCreating(true)}>Créer une campagne</button>
            <button style={btnDef} onClick={onGoToMailboxes}>Connecter une boîte</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {campaigns.map(campaign => {
            const state = CAMPAIGN_STATUS[campaign.status] || { label: campaign.status, color: '#9aa1b4' };
            const replyRate = campaign.sentCount > 0
              ? Math.round((campaign.replyCount / campaign.sentCount) * 1000) / 10 : 0;
            return (
              <div key={campaign.id} onClick={() => setSelected(campaign.id)}
                style={{ ...card, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{campaign.name}</span>
                    <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, color: state.color, background: `${state.color}18` }}>
                      {state.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#9aa1b4', marginTop: 4 }}>
                    {campaign._count.steps} étape{campaign._count.steps > 1 ? 's' : ''} ·
                    {' '}{campaign._count.enrollments} lead{campaign._count.enrollments > 1 ? 's' : ''} ·
                    {' '}{campaign.mailboxes.map(link => link.mailbox.email).join(', ') || 'aucune boîte'}
                  </div>
                </div>
                <Stat label="Envoyés" value={campaign.sentCount} />
                <Stat label="Réponses" value={campaign.replyCount} />
                <Stat label="Taux" value={`${replyRate} %`} accent />
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <CreateModal userName={user?.name} onClose={() => setCreating(false)}
          onCreated={id => { load(); setSelected(id); }} />
      )}
    </div>
  );
}

function Stat({ label: text, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div style={{ textAlign: 'right', minWidth: 68 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: accent ? '#8fb0ff' : '#e7e9ef' }}>{value}</div>
      <div style={{ fontSize: 10.5, color: '#6b7283' }}>{text}</div>
    </div>
  );
}

function CreateModal({ userName, onClose, onCreated }: {
  userName?: string; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [mailboxes, setMailboxes] = useState<Array<{ id: string; email: string; active: boolean }>>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/campaigns/mailboxes').then(res => res.json()).then(data => {
      const boxes = (data.mailboxes || []).filter((box: { active: boolean }) => box.active);
      setMailboxes(boxes);
      // Une seule boîte active : elle est choisie d'office, c'est le cas courant.
      if (boxes.length === 1) setPicked([boxes[0].id]);
    });
  }, []);

  const create = async () => {
    if (!name.trim()) { toast('Donnez un nom à la campagne', 'error'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), mailboxIds: picked, userName }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Création impossible', 'error'); return; }
      toast('Campagne créée');
      onCreated(data.campaign.id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay}
      onClick={onClose}>
      <div onClick={event => event.stopPropagation()} style={{ ...modal, width: 'min(520px, 100%)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Nouvelle campagne</div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>Nom</label>
          <input style={inp} autoFocus value={name} onChange={event => setName(event.target.value)}
            placeholder="Ex : Directeurs de magasin — Nord" />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={label}>Boîtes d&apos;envoi</label>
          {mailboxes.length === 0 ? (
            <div style={{ fontSize: 12.5, color: '#fbbf24' }}>
              Aucune boîte active. Connectez-en une avant de lancer la campagne
              (elle peut être créée dès maintenant, et affectée plus tard).
            </div>
          ) : mailboxes.map(mailbox => (
            <label key={mailbox.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '4px 0' }}>
              <input type="checkbox" checked={picked.includes(mailbox.id)}
                onChange={event => setPicked(current => event.target.checked
                  ? [...current, mailbox.id]
                  : current.filter(id => id !== mailbox.id))} />
              {mailbox.email}
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...btnPri, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={create}>Créer</button>
          <button style={btnDef} onClick={onClose}>Annuler</button>
        </div>
      </div>
    </div>
  );
}
