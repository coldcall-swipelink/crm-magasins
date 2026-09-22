'use client';
// src/components/campaigns/CampaignsPanel.tsx
//
// Écran « Campagnes » : la liste des séquences, et l'ouverture de l'une
// d'elles. Chaque carte donne l'essentiel — leads inscrits, progression,
// taux d'ouverture et de réponse, état — pour repérer d'un coup d'œil celle
// qui travaille. Les chiffres sont ceux de la vue d'ensemble, calculés au
// même endroit (src/lib/campaigns/stats.ts).

import { useCallback, useEffect, useState } from 'react';
import { useCurrentUser } from '@/lib/currentUser';
import { toast } from '@/components/ui/Toast';
import type { CampaignRow } from '@/lib/campaigns/stats';
import CampaignDetail from './CampaignDetail';
import { CAMPAIGN_STATUS, T, btnDef, btnPri, card, inp, label, modal, overlay } from './ui';

/** Une ligne de la liste : les chiffres viennent du même calcul que la vue d'ensemble. */
type Row = CampaignRow;

/** Les actives d'abord : c'est l'ordre que renvoie l'API, on le garde tel quel. */
export default function CampaignsPanel({ onGoToMailboxes }: { onGoToMailboxes: () => void }) {
  const { user } = useCurrentUser();
  const [campaigns, setCampaigns] = useState<Row[]>([]);
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

  const running = campaigns.filter(campaign => campaign.status === 'running').length;

  return (
    <div style={{ padding: '18px 24px 32px', maxWidth: 1100, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-.01em' }}>Campagnes</div>
          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>
            {campaigns.length === 0
              ? 'Une campagne enchaîne plusieurs emails espacés de délais d’attente, et s’arrête d’elle-même pour tout lead qui répond.'
              : <>
                  {campaigns.length} campagne{campaigns.length > 1 ? 's' : ''}
                  {' · '}
                  <span style={{ color: running > 0 ? '#4ade80' : T.textMuted }}>
                    {running} en cours
                  </span>
                </>}
          </div>
        </div>
        <button style={{ ...btnPri, marginLeft: 'auto' }} onClick={() => setCreating(true)}>+ Nouvelle campagne</button>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: T.textFaint }}>Chargement…</div>
      ) : campaigns.length === 0 ? (
        <div style={{ background: T.surface, border: `1px dashed #333a4a`, borderRadius: 12, padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>Aucune campagne</div>
          <div style={{ fontSize: 12.5, color: T.textMuted, marginBottom: 14 }}>
            Il faut d&apos;abord une boîte d&apos;envoi connectée et des leads importés.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button style={btnPri} onClick={() => setCreating(true)}>Créer une campagne</button>
            <button style={btnDef} onClick={onGoToMailboxes}>Connecter une boîte</button>
          </div>
        </div>
      ) : (
        <div className="camp-campaign-list">
          {/* Intitulés de colonnes, alignés sur la grille des cartes. */}
          <div className="camp-campaign-grid" style={{ ...GRID, padding: '0 18px 8px', fontSize: 11, fontWeight: 600, color: T.textFaint, letterSpacing: '.02em', textTransform: 'uppercase' }}>
            <div>Campagne</div>
            <div style={{ textAlign: 'right' }}>Leads</div>
            <div>Progression</div>
            <div style={{ textAlign: 'right' }}>Ouverture</div>
            <div style={{ textAlign: 'right' }}>Réponse</div>
            <div style={{ textAlign: 'right' }}>État</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {campaigns.map(campaign => (
              <CampaignCard key={campaign.id} campaign={campaign} onOpen={() => setSelected(campaign.id)} />
            ))}
          </div>
          <div style={{ fontSize: 11, color: T.textFaint, marginTop: 14, lineHeight: 1.6 }}>
            Progression : part des envois prévus déjà partis — une séquence arrêtée (réponse,
            désinscription, adresse morte) compte comme terminée. Ouverture mesurée sur les emails
            envoyés, réponse sur les leads contactés.
          </div>
        </div>
      )}

      {creating && (
        <CreateModal userName={user?.name} onClose={() => setCreating(false)}
          onCreated={id => { load(); setSelected(id); }} />
      )}
    </div>
  );
}

/** Grille commune aux intitulés et aux cartes : les colonnes tombent l'une sous l'autre. */
const GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 90px 200px 100px 100px 118px',
  gap: 20, alignItems: 'center',
};

function formatCreated(value: string): string {
  return new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Une campagne : son nom et sa date, ses leads, sa progression, ses taux, son état. */
function CampaignCard({ campaign, onOpen }: { campaign: Row; onOpen: () => void }) {
  const state = CAMPAIGN_STATUS[campaign.status] || { label: campaign.status, color: T.textMuted };
  const live = campaign.status === 'running';
  const done = campaign.progress >= 100;
  const untouched = campaign.sent === 0;

  return (
    <div className="camp-campaign-card camp-campaign-grid" onClick={onOpen} style={{
      ...GRID, ...card, padding: '14px 18px', cursor: 'pointer',
      // Une campagne en cours se repère à son liseré, avant même de lire l'état.
      borderLeft: `3px solid ${live ? '#4ade80' : T.border}`,
    }}>
      {/* Nom, date de création, taille de la séquence */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 650, display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{campaign.name}</span>
          {campaign.priority && (
            <span
              title="Campagne prioritaire : ses leads passent devant ceux des autres dans la file de chaque boîte d'envoi"
              style={{
                flexShrink: 0, padding: '1px 7px', borderRadius: 999, fontSize: 10,
                fontWeight: 800, letterSpacing: '.04em',
                color: T.warnText, background: T.warnSoft, border: `1px solid ${T.warn}55`,
              }}>
              PRIO
            </span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          Créée le {formatCreated(campaign.createdAt)}
          {' · '}{campaign.steps} étape{campaign.steps > 1 ? 's' : ''}
          {campaign.sent > 0 && <>{' · '}{campaign.sent} email{campaign.sent > 1 ? 's' : ''} envoyé{campaign.sent > 1 ? 's' : ''}</>}
        </div>
      </div>

      {/* Leads inscrits */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{campaign.enrolled}</div>
        <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 3, whiteSpace: 'nowrap' }}>
          {campaign.contacted} contacté{campaign.contacted > 1 ? 's' : ''}
        </div>
      </div>

      {/* Progression */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 650, fontVariantNumeric: 'tabular-nums', color: done ? '#4ade80' : T.text }}>
            {campaign.progress} %
          </span>
          <span style={{ fontSize: 10.5, color: T.textFaint }}>
            {done ? 'terminée' : campaign.enrolled === 0 ? 'aucun lead' : `${campaign.completed} séquence${campaign.completed > 1 ? 's' : ''} complète${campaign.completed > 1 ? 's' : ''}`}
          </span>
        </div>
        <Bar value={campaign.progress} color={done ? T.success : T.primary} height={6} />
      </div>

      {/* Taux d'ouverture */}
      <Rate value={campaign.openRate} count={campaign.opened} noun="ouverture" color={T.violet} muted={untouched} />

      {/* Taux de réponse */}
      <Rate value={campaign.replyRate} count={campaign.replied} noun="réponse" color={T.success} muted={untouched} />

      {/* État */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999,
          fontSize: 11.5, fontWeight: 600, color: state.color, background: `${state.color}18`,
          border: `1px solid ${state.color}33`, whiteSpace: 'nowrap',
        }}>
          <span className={live ? 'camp-live-dot' : undefined}
            style={{ width: 7, height: 7, borderRadius: '50%', background: state.color, display: 'inline-block' }} />
          {live ? 'Active' : state.label}
        </span>
      </div>
    </div>
  );
}

/** Un taux : le chiffre, le nombre derrière, et une jauge fine pour le lire d'un coup d'œil. */
function Rate({ value, count, noun, color, muted }: { value: number; count: number; noun: string; color: string; muted: boolean }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, color: muted ? T.textFaint : T.text }}>
        {muted ? '—' : `${value} %`}
      </div>
      <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 3, marginBottom: 5 }}>
        {muted ? 'rien d’envoyé' : `${count} ${noun}${count > 1 ? 's' : ''}`}
      </div>
      <Bar value={muted ? 0 : value} color={color} height={3} />
    </div>
  );
}

function Bar({ value, color, height }: { value: number; color: string; height: number }) {
  return (
    <div style={{ height, borderRadius: height, background: T.surfaceHi, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', background: color, borderRadius: height, transition: 'width .3s ease' }} />
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
