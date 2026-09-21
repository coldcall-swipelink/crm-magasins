'use client';
// src/components/deal/CampaignLeadsBlock.tsx
//
// « Leads de campagne » sur la fiche affaire.
//
// Dit, avant d'appeler, qu'une prospection par email touche déjà ce magasin :
// un lead rattaché à l'affaire, ou un lead importé d'un fichier dont
// l'enseigne et la ville correspondent. Le second cas est signalé comme un
// rapprochement, pas comme une certitude — même magasin ne veut pas dire même
// interlocuteur.

import { useEffect, useState } from 'react';
import { statusColor, statusLabel } from '@/lib/campaigns/leadFields';

type DealLead = {
  id: string; email: string; name: string; jobTitle: string; company: string; city: string;
  status: string; kind: 'linked' | 'matched'; lastContactedAt: string | null;
  campaigns: Array<{ id: string; name: string; status: string }>;
};

export default function CampaignLeadsBlock({ dealId }: { dealId: string }) {
  const [leads, setLeads] = useState<DealLead[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/deals/${dealId}/campaign-leads`)
      .then(res => res.json())
      .then(data => { if (alive) { setLeads(data.leads || []); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [dealId]);

  // Rien à dire tant qu'on n'a rien trouvé : la fiche affaire est déjà dense.
  if (!loaded || leads.length === 0) return null;

  const matched = leads.filter(lead => lead.kind === 'matched').length;

  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
      padding: '12px 14px', marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
          📣 Leads de campagne ({leads.length})
        </span>
        {matched > 0 && (
          <span style={{ fontSize: 11, color: '#b45309', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 999, padding: '1px 8px' }}>
            {matched} rapproché{matched > 1 ? 's' : ''} par enseigne + ville
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {leads.map(lead => (
          <div key={lead.id} style={{
            border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 10px',
            borderLeft: `3px solid ${lead.kind === 'linked' ? '#4f46e5' : '#f59e0b'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a' }}>
                {lead.name || lead.email}
              </span>
              <span style={{
                padding: '1px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 600,
                color: statusColor(lead.status), background: `${statusColor(lead.status)}1a`,
              }}>{statusLabel(lead.status)}</span>
              <span
                title={lead.kind === 'linked'
                  ? "Ce lead vient de cette affaire : leurs champs de contact sont liés."
                  : "Même enseigne et même ville que cette affaire. Rapprochement probable, pas certain."}
                style={{ fontSize: 10.5, color: '#64748b' }}>
                {lead.kind === 'linked' ? 'lié à cette affaire' : 'rapproché (enseigne + ville)'}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>
              {lead.email}
              {lead.jobTitle ? ` · ${lead.jobTitle}` : ''}
              {lead.lastContactedAt
                ? ` · dernier email le ${new Date(lead.lastContactedAt).toLocaleDateString('fr-FR')}`
                : ' · jamais contacté par email'}
            </div>
            {lead.campaigns.length > 0 && (
              <div style={{ fontSize: 11.5, color: '#475569', marginTop: 3 }}>
                Dans {lead.campaigns.length > 1 ? 'les campagnes' : 'la campagne'}{' '}
                {lead.campaigns.map(campaign => campaign.name).join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, lineHeight: 1.5 }}>
        Un lead « rapproché » partage l&apos;enseigne et la ville de ce magasin sans être
        rattaché à l&apos;affaire : vérifiez qu&apos;il s&apos;agit bien du même interlocuteur avant
        d&apos;en tirer une conclusion.
      </div>
    </div>
  );
}
