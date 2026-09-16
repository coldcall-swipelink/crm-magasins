'use client';
// src/app/campagnes/page.tsx
//
// Onglet « Campagnes » : l'outil de séquences d'emails.
//
// Livré par étapes. Aujourd'hui : les leads (import, suivi un par un) et les
// boîtes d'envoi (connexion SMTP/IMAP directe à Google Workspace et OVH).
// À suivre : les séquences et leur moteur d'envoi, puis les tableaux de bord.

import { useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import LeadsPanel from '@/components/campaigns/LeadsPanel';
import MailboxesPanel from '@/components/campaigns/MailboxesPanel';

const TABS = [
  { key: 'campaigns', label: 'Campagnes' },
  { key: 'leads',     label: 'Leads' },
  { key: 'mailboxes', label: "Boîtes d'envoi" },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function CampagnesPage() {
  const [tab, setTab] = useState<TabKey>('leads');

  return (
    <AppLayout>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <div style={{ padding: '10px 20px 0', background: '#fff', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Campagnes</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {TABS.map(item => {
              const active = tab === item.key;
              return (
                <button key={item.key} onClick={() => setTab(item.key)} style={{
                  padding: '7px 14px', fontSize: 13, border: 'none', background: 'transparent',
                  cursor: 'pointer', fontWeight: active ? 600 : 400,
                  color: active ? '#4338ca' : '#64748b',
                  borderBottom: `2px solid ${active ? '#6366f1' : 'transparent'}`,
                }}>{item.label}</button>
              );
            })}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {tab === 'leads' && <LeadsPanel />}
          {tab === 'mailboxes' && <MailboxesPanel />}
          {tab === 'campaigns' && <CampaignsPlaceholder onGoToMailboxes={() => setTab('mailboxes')} />}
        </div>
      </div>
    </AppLayout>
  );
}

/** Étape suivante du chantier : le moteur de séquences. */
function CampaignsPlaceholder({ onGoToMailboxes }: { onGoToMailboxes: () => void }) {
  return (
    <div style={{ padding: '40px 24px', maxWidth: 640 }}>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Séquences d&apos;emails — en cours de développement</div>
        <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
          Les briques nécessaires sont en place : les <strong>leads</strong> avec leurs champs
          personnalisés, et les <strong>boîtes d&apos;envoi</strong> connectées en direct.
          L&apos;étape suivante ajoute la création de campagnes (étapes, délais d&apos;attente,
          arrêt automatique dès qu&apos;un lead répond), puis les tableaux de bord.
        </div>
        <button onClick={onGoToMailboxes} style={{ marginTop: 16, padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontSize: 13, cursor: 'pointer' }}>
          Connecter une boîte d&apos;envoi
        </button>
      </div>
    </div>
  );
}
