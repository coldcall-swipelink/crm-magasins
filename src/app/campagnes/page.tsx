'use client';
// src/app/campagnes/page.tsx
//
// Onglet « Campagnes » : l'outil de séquences d'emails.
//
// Six écrans : la vue d'ensemble, les campagnes (séquences d'emails et leur
// suivi), les leads (import, statuts, notes), les déclencheurs (une offre de
// boucher qui sort inscrit le contact dans la campagne bouchers), l'historique
// des emails — partis et à venir, toutes campagnes confondues — et les boîtes
// d'envoi (connexion SMTP/IMAP directe à Google Workspace et OVH).

import { useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { T } from '@/components/campaigns/ui';
import CampaignsPanel from '@/components/campaigns/CampaignsPanel';
import DashboardPanel from '@/components/campaigns/DashboardPanel';
import LeadsPanel from '@/components/campaigns/LeadsPanel';
import MailboxesPanel from '@/components/campaigns/MailboxesPanel';
import MessagesHistory from '@/components/campaigns/MessagesHistory';
import OfferTriggersPanel from '@/components/campaigns/OfferTriggersPanel';

const TABS = [
  { key: 'overview',  label: "Vue d'ensemble" },
  { key: 'campaigns', label: 'Campagnes' },
  { key: 'leads',     label: 'Leads' },
  { key: 'triggers',  label: 'Déclencheurs' },
  { key: 'history',   label: 'Historique' },
  { key: 'mailboxes', label: "Boîtes d'envoi" },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function CampagnesPage() {
  const [tab, setTab] = useState<TabKey>('overview');

  return (
    <AppLayout>
      {/* La classe « camp » porte le survol, le focus et les finitions que des
          styles en ligne ne savent pas exprimer (cf. globals.css). */}
      <div className="camp" style={{
        display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
        background: T.bg, color: T.text,
      }}>
        <div style={{ padding: '14px 24px 0', background: T.bgPanel, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.01em' }}>Campagnes</div>
            <div style={{ fontSize: 12, color: T.textFaint }}>
              Prospection par email — séquences, leads et boîtes d&apos;envoi
            </div>
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            {TABS.map(item => {
              const active = tab === item.key;
              return (
                <button key={item.key} onClick={() => setTab(item.key)} className="camp-tab" style={{
                  padding: '9px 14px', fontSize: 13, border: 'none', background: 'transparent',
                  cursor: 'pointer', fontWeight: active ? 650 : 500,
                  color: active ? T.text : T.textMuted,
                  borderBottom: `2px solid ${active ? T.primary : 'transparent'}`,
                  marginBottom: -1,
                }}>{item.label}</button>
              );
            })}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {tab === 'overview' && <DashboardPanel onOpenCampaigns={() => setTab('campaigns')} />}
          {tab === 'leads' && <LeadsPanel />}
          {tab === 'triggers' && <OfferTriggersPanel onGoToCampaigns={() => setTab('campaigns')} />}
          {tab === 'history' && <MessagesHistory />}
          {tab === 'mailboxes' && <MailboxesPanel />}
          {tab === 'campaigns' && <CampaignsPanel onGoToMailboxes={() => setTab('mailboxes')} />}
        </div>
      </div>
    </AppLayout>
  );
}
