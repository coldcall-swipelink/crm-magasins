'use client';
// src/components/campaigns/EnrollInCampaignModal.tsx
//
// Envoi de leads vers une campagne, depuis la liste générale des leads.
//
// On a coché des leads (ou posé un filtre : enseigne, étape CRM…), on choisit
// la campagne, et ils y sont inscrits. Deux portées, comme dans le choix de
// leads depuis une campagne : les leads cochés, ou tous ceux de la recherche
// en cours — sans les cocher un par un.

import { useEffect, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { CAMPAIGN_STATUS, T, btnDef, btnPri, inp, label, modal, overlay } from './ui';

type CampaignRow = { id: string; name: string; status: string; enrolled?: number };

/** Recherche en cours de la liste, telle que l'API des inscriptions la comprend. */
export type LeadSearchFilter = {
  q?: string; status?: string; company?: string; jobTitle?: string;
  pipelineId?: string; columnIds?: string[];
};

export default function EnrollInCampaignModal({ leadIds, filter, filterTotal, onClose, onDone }: {
  /** Les leads cochés. */
  leadIds: string[];
  /** La recherche en cours, pour inscrire tout ce qu'elle renvoie. */
  filter: LeadSearchFilter;
  /** Nombre de leads dans la recherche en cours. */
  filterTotal: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null);
  const [campaignId, setCampaignId] = useState('');
  const [scope, setScope] = useState<'picked' | 'filter'>(leadIds.length > 0 ? 'picked' : 'filter');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/campaigns')
      .then(res => res.json())
      .then(data => {
        // Une campagne archivée ne reçoit plus personne : on ne la propose pas.
        const open = ((data.campaigns || []) as CampaignRow[]).filter(c => c.status !== 'archived');
        setCampaigns(open);
        if (open.length === 1) setCampaignId(open[0].id);
      })
      .catch(() => setCampaigns([]));
  }, []);

  const count = scope === 'picked' ? leadIds.length : filterTotal;
  const canRun = !!campaignId && count > 0 && !busy;

  const run = async () => {
    if (!canRun) return;
    setBusy(true);
    try {
      const body = scope === 'picked' ? { leadIds } : { filter };
      const res = await fetch(`/api/campaigns/${campaignId}/enrollments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Inscription impossible', 'error'); return; }

      const reasons = Object.entries(data.reasons || {}).map(([reason, n]) => `${n} ${reason}`).join(', ');
      toast(`${data.enrolled} lead(s) inscrit(s)`
        + (data.skipped ? ` · ${data.skipped} écarté(s) : ${reasons}` : '')
        + (data.sent ? ` · ${data.sent} email(s) déjà parti(s)` : ''));
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const chosen = campaigns?.find(c => c.id === campaignId);

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={event => event.stopPropagation()} style={{ ...modal, width: 'min(520px, 100%)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Envoyer dans une campagne</div>
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 16 }}>
          Les leads sont inscrits dans la séquence de la campagne choisie. Les désinscrits, les
          adresses mortes et les leads déjà dans cette campagne sont écartés automatiquement.
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>Campagne</label>
          {campaigns === null ? (
            <div style={{ fontSize: 12.5, color: T.textFaint }}>Chargement des campagnes…</div>
          ) : campaigns.length === 0 ? (
            <div style={{ fontSize: 12.5, color: T.textFaint }}>
              Aucune campagne ouverte. Créez-en une dans l&apos;écran Campagnes.
            </div>
          ) : (
            <select style={inp} value={campaignId} onChange={event => setCampaignId(event.target.value)}>
              <option value="">Choisir une campagne…</option>
              {campaigns.map(campaign => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name} — {CAMPAIGN_STATUS[campaign.status]?.label || campaign.status}
                  {typeof campaign.enrolled === 'number' ? ` · ${campaign.enrolled} lead(s)` : ''}
                </option>
              ))}
            </select>
          )}
          {chosen && chosen.status === 'draft' && (
            <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 6 }}>
              Campagne en brouillon : les leads seront inscrits mais rien ne partira avant son lancement.
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={label}>Qui inscrire</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: leadIds.length ? T.text : T.textFaint }}>
              <input type="radio" name="scope" checked={scope === 'picked'} disabled={leadIds.length === 0}
                onChange={() => setScope('picked')} />
              Les {leadIds.length} lead{leadIds.length > 1 ? 's' : ''} coché{leadIds.length > 1 ? 's' : ''}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: filterTotal ? T.text : T.textFaint }}>
              <input type="radio" name="scope" checked={scope === 'filter'} disabled={filterTotal === 0}
                onChange={() => setScope('filter')} />
              Tous les {filterTotal} lead{filterTotal > 1 ? 's' : ''} de la recherche en cours
              <span style={{ color: T.textFaint, fontSize: 11.5 }}>(filtres d&apos;enseigne, de poste, de statut et d&apos;étape CRM compris)</span>
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...btnPri, opacity: canRun ? 1 : 0.6 }} disabled={!canRun} onClick={run}>
            {busy ? 'Inscription…' : `Inscrire ${count} lead${count > 1 ? 's' : ''}`}
          </button>
          <button style={{ ...btnDef, marginLeft: 'auto' }} onClick={onClose}>Annuler</button>
        </div>
      </div>
    </div>
  );
}
