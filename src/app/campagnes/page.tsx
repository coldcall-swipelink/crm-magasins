'use client';
// src/app/campagnes/page.tsx
//
// Onglet « Campagnes » : l'outil de séquences d'emails.
//
// Trois écrans : les campagnes (séquences d'emails et leur suivi), les leads
// (import, statuts, notes) et les boîtes d'envoi (connexion SMTP/IMAP directe
// à Google Workspace et OVH).

import { useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import CampaignsPanel from '@/components/campaigns/CampaignsPanel';
import DashboardPanel from '@/components/campaigns/DashboardPanel';
import LeadsPanel from '@/components/campaigns/LeadsPanel';
import MailboxesPanel from '@/components/campaigns/MailboxesPanel';

const TABS = [
  { key: 'overview',  label: "Vue d'ensemble" },
  { key: 'campaigns', label: 'Campagnes' },
  { key: 'leads',     label: 'Leads' },
  { key: 'mailboxes', label: "Boîtes d'envoi" },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function CampagnesPage() {
  const [tab, setTab] = useState<TabKey>('overview');

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
          {tab === 'overview' && <DashboardPanel onOpenCampaigns={() => setTab('campaigns')} />}
          {tab === 'leads' && <LeadsPanel />}
          {tab === 'mailboxes' && <MailboxesPanel />}
          {tab === 'campaigns' && <CampaignsPanel onGoToMailboxes={() => setTab('mailboxes')} />}
        </div>
      </div>
    </AppLayout>
  );
}
