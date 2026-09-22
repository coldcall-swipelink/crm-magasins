'use client';
// src/components/campaigns/CampaignDetail.tsx
//
// Une campagne ouverte : son en-tête (lancer / mettre en pause), sa séquence,
// ses leads et ses statistiques.
//
// Lancer une campagne n'envoie rien tout de suite : cela rend simplement ses
// inscriptions éligibles au moteur, qui respectera les plages horaires et les
// quotas des boîtes.

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import SequenceEditor, { type Step } from './SequenceEditor';
import CampaignDiagnostics from './CampaignDiagnostics';
import CampaignLeadsTab from './CampaignLeadsTab';
import CampaignStatsTab, { type Stats } from './CampaignStatsTab';
import MessagesHistory from './MessagesHistory';
import { CAMPAIGN_STATUS, btnDef, btnPri, btnXs, card, inp, label } from './ui';

type Campaign = {
  id: string; name: string; description: string; status: string;
  stopOnReply: boolean; trackOpens: boolean; addUnsubscribe: boolean; priority: boolean;
  startedAt: string | null;
  steps: Step[];
  mailboxes: Array<{ mailboxId: string; mailbox: { id: string; email: string; displayName: string; active: boolean } }>;
};

type MailboxOption = { id: string; email: string; displayName: string; active: boolean };

const TABS = [
  { key: 'sequence', label: 'Séquence' },
  { key: 'leads',    label: 'Leads' },
  { key: 'history',  label: 'Historique' },
  { key: 'stats',    label: 'Statistiques' },
  { key: 'settings', label: 'Réglages' },
] as const;

export default function CampaignDetail({ campaignId, onBack, onChanged }: {
  campaignId: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [mailboxes, setMailboxes] = useState<MailboxOption[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('sequence');
  // Erreur de chargement, affichée à la place de « Chargement… ». Sans cela,
  // une route qui tombe (base en retard sur le schéma, par exemple) laisse
  // l'écran tourner indéfiniment sans rien dire — c'est arrivé.
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [detailRes, boxesRes] = await Promise.all([
        fetch(`/api/campaigns/${campaignId}`),
        fetch('/api/campaigns/mailboxes'),
      ]);
      // Une erreur serveur non prévue arrive en texte, pas en JSON : on la
      // lit telle quelle plutôt que de laisser `res.json()` casser en silence.
      const detail = await detailRes.json().catch(() => ({ error: `Erreur serveur (${detailRes.status})` }));
      const boxes = await boxesRes.json().catch(() => ({ mailboxes: [] }));
      if (detailRes.status === 404) { toast(detail.error || 'Campagne introuvable', 'error'); onBack(); return; }
      if (!detailRes.ok || detail.error) { setLoadError(detail.error || `Erreur serveur (${detailRes.status})`); return; }
      setCampaign(detail.campaign);
      setStats(detail.stats);
      setMailboxes(boxes.mailboxes || []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Chargement impossible');
    }
  }, [campaignId, onBack]);

  useEffect(() => { load(); }, [load]);

  const patch = async (data: Record<string, unknown>) => {
    const res = await fetch(`/api/campaigns/${campaignId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok) { toast(result.error || 'Modification refusée', 'error'); return false; }
    // Au lancement, le moteur fait partir la première salve : on le dit.
    if (data.status === 'running') {
      toast(result.sent > 0
        ? `Campagne lancée — ${result.sent} email(s) déjà parti(s)`
        : 'Campagne lancée — les envois partent au rythme des boîtes');
    }
    await load();
    onChanged();
    return true;
  };

  const remove = async () => {
    if (!campaign) return;
    if (!confirm(`Supprimer « ${campaign.name} » ? Les emails déjà envoyés disparaîtront des statistiques.`)) return;
    const res = await fetch(`/api/campaigns/${campaignId}`, { method: 'DELETE' });
    if (!res.ok) { toast('Suppression impossible', 'error'); return; }
    toast('Campagne supprimée');
    onChanged();
    onBack();
  };

  if (loadError) {
    return (
      <div style={{ padding: 24, maxWidth: 720 }}>
        <button style={btnXs} onClick={onBack}>← Campagnes</button>
        <div style={{ marginTop: 14, background: 'rgba(239,68,68,.13)', border: '1px solid rgba(239,68,68,.35)', borderRadius: 8, padding: '12px 14px', fontSize: 12.5, color: '#f87171', lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>La campagne n&apos;a pas pu être chargée</div>
          <div>{loadError}</div>
          <div style={{ color: '#9aa1b4', marginTop: 8 }}>
            Si l&apos;erreur parle d&apos;une table ou d&apos;une colonne inconnue, la base est en retard sur
            l&apos;application : lancez la synchronisation du schéma (route <code>/api/admin/db-sync</code>) puis réessayez.
          </div>
        </div>
        <button style={{ ...btnDef, marginTop: 12 }} onClick={load}>Réessayer</button>
      </div>
    );
  }

  if (!campaign || !stats) {
    return <div style={{ padding: 24, fontSize: 13, color: '#6b7283' }}>Chargement…</div>;
  }

  const state = CAMPAIGN_STATUS[campaign.status] || { label: campaign.status, color: '#9aa1b4' };
  const activeBoxes = campaign.mailboxes.filter(link => link.mailbox.active).length;

  return (
    // Colonne : le bandeau reste fixe, le corps de l'onglet défile. L'onglet
    // Séquence gère lui-même son défilement (deux volets indépendants), les
    // autres défilent d'un bloc.
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '14px 24px', background: '#171a23', borderBottom: '1px solid #262b38', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={btnXs} onClick={onBack}>← Campagnes</button>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{campaign.name}</div>
          <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: state.color, background: `${state.color}18` }}>
            {state.label}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 7 }}>
            {campaign.status === 'running' ? (
              <button style={btnDef} onClick={() => patch({ status: 'paused' })}>Mettre en pause</button>
            ) : (
              <button style={btnPri} onClick={() => patch({ status: 'running' })}>
                {campaign.status === 'draft' ? 'Lancer la campagne' : 'Reprendre'}
              </button>
            )}
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#9aa1b4', marginTop: 6 }}>
          {campaign.steps.length} étape{campaign.steps.length > 1 ? 's' : ''} ·
          {' '}{activeBoxes} boîte{activeBoxes > 1 ? 's' : ''} d&apos;envoi ·
          {' '}{stats.contacted} lead{stats.contacted > 1 ? 's' : ''} contacté{stats.contacted > 1 ? 's' : ''} ·
          {' '}{stats.sent} email{stats.sent > 1 ? 's' : ''} envoyé{stats.sent > 1 ? 's' : ''}
        </div>

        <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
          {TABS.map(item => {
            const active = tab === item.key;
            return (
              <button key={item.key} onClick={() => setTab(item.key)} style={{
                padding: '6px 12px', fontSize: 12.5, border: 'none', background: 'transparent',
                cursor: 'pointer', fontWeight: active ? 600 : 400,
                color: active ? '#8fb0ff' : '#9aa1b4',
                borderBottom: `2px solid ${active ? '#3b71f5' : 'transparent'}`,
              }}>{item.label}</button>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: tab === 'sequence' ? 'hidden' : 'auto' }}>
      {campaign.status === 'draft' && activeBoxes === 0 && (
        <div style={{ margin: '14px 24px 0', flexShrink: 0, background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.35)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: '#fbbf24' }}>
          Aucune boîte d&apos;envoi active n&apos;est affectée : la campagne ne pourra pas être lancée.
          Choisissez-en une dans l&apos;onglet <strong>Réglages</strong>.
        </div>
      )}

      {(tab === 'leads' || tab === 'stats') && (
        <div style={{ padding: '14px 24px 0' }}>
          <CampaignDiagnostics campaignId={campaignId} onSent={load} />
        </div>
      )}

      {tab === 'sequence' && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <SequenceEditor campaignId={campaignId} steps={campaign.steps} onChanged={load} />
        </div>
      )}
      {tab === 'leads' && <CampaignLeadsTab campaignId={campaignId} onChanged={load} />}
      {tab === 'history' && <MessagesHistory campaignId={campaignId} />}
      {tab === 'stats' && <CampaignStatsTab stats={stats} trackOpens={campaign.trackOpens} />}
      {tab === 'settings' && (
        <SettingsTab campaign={campaign} mailboxes={mailboxes} onPatch={patch} onDelete={remove} />
      )}
      </div>
    </div>
  );
}

function SettingsTab({ campaign, mailboxes, onPatch, onDelete }: {
  campaign: Campaign;
  mailboxes: MailboxOption[];
  onPatch: (data: Record<string, unknown>) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description);
  const selected = new Set(campaign.mailboxes.map(link => link.mailboxId));

  const toggleMailbox = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onPatch({ mailboxIds: Array.from(next) });
  };

  return (
    <div style={{ padding: '18px 24px', maxWidth: 720 }}>
      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ marginBottom: 12 }}>
          <label style={label}>Nom de la campagne</label>
          <input style={inp} value={name} onChange={event => setName(event.target.value)} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={label}>Description (interne)</label>
          <input style={inp} value={description} onChange={event => setDescription(event.target.value)} />
        </div>
        <button style={btnPri} onClick={() => onPatch({ name, description })}>Enregistrer</button>
      </div>

      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Boîtes d&apos;envoi</div>
        <div style={{ fontSize: 12, color: '#9aa1b4', marginBottom: 12 }}>
          Plusieurs boîtes = rotation : le volume se répartit, mais chaque lead reçoit
          toute sa séquence depuis une seule adresse (sinon les relances ne se
          rattachent pas au fil du premier email).
        </div>
        {mailboxes.length === 0 && (
          <div style={{ fontSize: 12.5, color: '#6b7283' }}>
            Aucune boîte connectée — rendez-vous dans l&apos;onglet « Boîtes d&apos;envoi ».
          </div>
        )}
        {mailboxes.map(mailbox => (
          <label key={mailbox.id} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid #1c1f2a' }}>
            <input type="checkbox" checked={selected.has(mailbox.id)} onChange={() => toggleMailbox(mailbox.id)} />
            <span style={{ fontWeight: 500 }}>{mailbox.email}</span>
            <span style={{ color: '#6b7283' }}>{mailbox.displayName}</span>
            {!mailbox.active && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#fbbf24' }}>en pause</span>}
          </label>
        ))}
      </div>

      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Comportement</div>
        <Toggle
          checked={campaign.stopOnReply}
          onChange={value => onPatch({ stopOnReply: value })}
          title="Arrêter la séquence dès qu'un lead répond"
          hint="Détecté par le relevé IMAP des boîtes d'envoi. Sans cela, un lead qui a répondu continuerait de recevoir les relances."
        />
        <Toggle
          checked={campaign.trackOpens}
          onChange={value => onPatch({ trackOpens: value })}
          title="Suivre les ouvertures"
          hint="Pixel invisible en bas de l'email. Le taux se lit comme une tendance : une image bloquée ne compte pas, un pré-chargement compte à tort."
        />
        <Toggle
          checked={campaign.addUnsubscribe}
          onChange={value => onPatch({ addUnsubscribe: value })}
          title="Ajouter un lien de désinscription"
          hint="Lien en bas de l'email et en-tête List-Unsubscribe. Fortement recommandé en prospection à froid : c'est ce qui évite les plaintes pour spam."
        />
        <Toggle
          checked={campaign.priority}
          onChange={value => onPatch({ priority: value })}
          title="Campagne prioritaire"
          hint="Ses leads passent devant ceux des autres campagnes dans la file de chaque boîte d'envoi. Le quota journalier ne change pas : c'est l'ordre d'écoulement qui change, pas le volume. Utile quand le total des leads dépasse ce qu'une journée peut envoyer — sans cela, les campagnes avancent de front et aucune n'arrive au bout."
        />
      </div>

      <button style={{ ...btnDef, borderColor: 'rgba(239,68,68,.35)', background: 'rgba(239,68,68,.13)', color: '#f87171' }} onClick={onDelete}>
        Supprimer la campagne
      </button>
    </div>
  );
}

function Toggle({ checked, onChange, title, hint }: {
  checked: boolean; onChange: (value: boolean) => void; title: string; hint: string;
}) {
  return (
    <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid #1c1f2a', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} style={{ marginTop: 3 }} />
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 11.5, color: '#6b7283', marginTop: 2 }}>{hint}</div>
      </div>
    </label>
  );
}
