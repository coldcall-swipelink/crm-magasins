'use client';
// src/app/campagnes/[[...section]]/page.tsx
//
// L'outil « Campagnes » : les séquences d'emails.
//
// C'est un espace à part entière, au même titre que le CRM : on y bascule
// depuis le sélecteur en haut du volet gauche, et le volet porte alors ses
// écrans. Six écrans, un par adresse : la vue d'ensemble (/campagnes), les
// campagnes (séquences d'emails et leur suivi), les leads (import, statuts,
// notes), les déclencheurs (une offre de boucher qui sort inscrit le contact
// dans la campagne bouchers), l'historique des emails — partis et à venir,
// toutes campagnes confondues — et les boîtes d'envoi (connexion SMTP/IMAP
// directe à Google Workspace et OVH). Les adresses sont celles du menu, dans
// src/lib/workspace.ts.

import { notFound, useParams, useRouter } from 'next/navigation';
import AppLayout from '@/components/layout/AppLayout';
import { T } from '@/components/campaigns/ui';
import CampaignsPanel from '@/components/campaigns/CampaignsPanel';
import DashboardPanel from '@/components/campaigns/DashboardPanel';
import LeadsPanel from '@/components/campaigns/LeadsPanel';
import MailboxesPanel from '@/components/campaigns/MailboxesPanel';
import MessagesHistory from '@/components/campaigns/MessagesHistory';
import OfferTriggersPanel from '@/components/campaigns/OfferTriggersPanel';

/** Segment d'adresse → écran. La racine (aucun segment) est la vue d'ensemble. */
const SECTIONS = {
  '':             'overview',
  sequences:      'campaigns',
  leads:          'leads',
  declencheurs:   'triggers',
  historique:     'history',
  boites:         'mailboxes',
} as const;

type Section = (typeof SECTIONS)[keyof typeof SECTIONS];

export default function CampagnesPage() {
  const router = useRouter();
  const params = useParams<{ section?: string[] }>();
  const segments = params.section ?? [];
  const slug = segments.length === 0 ? '' : segments.length === 1 ? segments[0] : null;
  const section: Section | undefined = slug === null ? undefined : SECTIONS[slug as keyof typeof SECTIONS];
  if (!section) notFound();

  const goTo = (target: keyof typeof SECTIONS) => router.push(target ? `/campagnes/${target}` : '/campagnes');

  return (
    <AppLayout>
      {/* La classe « camp » porte le survol, le focus et les finitions que des
          styles en ligne ne savent pas exprimer (cf. globals.css). */}
      <div className="camp" style={{
        display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
        background: T.bg, color: T.text,
      }}>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {section === 'overview' && <DashboardPanel onOpenCampaigns={() => goTo('sequences')} />}
          {section === 'campaigns' && <CampaignsPanel onGoToMailboxes={() => goTo('boites')} />}
          {section === 'leads' && <LeadsPanel />}
          {section === 'triggers' && <OfferTriggersPanel onGoToCampaigns={() => goTo('sequences')} />}
          {section === 'history' && <MessagesHistory />}
          {section === 'mailboxes' && <MailboxesPanel />}
        </div>
      </div>
    </AppLayout>
  );
}
