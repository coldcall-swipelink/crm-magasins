'use client';
// src/components/campaigns/OfferTriggersPanel.tsx
//
// Écran « Déclencheurs » : les règles qui relient un métier recherché à une
// campagne. « Quand une offre de boucher sort, inscris le contact de l'affaire
// dans la campagne bouchers. »
//
// L'écran insiste sur trois choses, parce qu'une règle envoie de vrais emails
// sans que personne ne clique :
//   • ce qu'elle attraperait (aperçu chiffré avant d'enregistrer),
//   • depuis quand elle regarde (une règle neuve ignore l'historique),
//   • ce qu'elle a fait (journal, y compris les non-inscriptions et pourquoi).

import { useCallback, useEffect, useState } from 'react';
import { useCurrentUser } from '@/lib/currentUser';
import { toast } from '@/components/ui/Toast';
import { OFFER_VARIABLES } from '@/lib/campaigns/offerMatch';
import OfferTriggerModal from './OfferTriggerModal';
import OfferTriggerJournal from './OfferTriggerJournal';
import ReadErrorBanner from './ReadErrorBanner';
import { T, btnDanger, btnDef, btnPri, btnXs } from './ui';

export type TriggerRow = {
  id: string;
  name: string;
  keywords: string;
  exclude: string;
  active: boolean;
  campaignId: string;
  pipelineId: string | null;
  brandId: string | null;
  since: string;
  lastRunAt: string | null;
  matchedCount: number;
  enrolledCount: number;
  campaign: { id: string; name: string; status: string };
  _count?: { hits: number };
};

export type TriggerOptions = {
  campaigns: Array<{ id: string; name: string; status: string }>;
  pipelines: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string }>;
  titles: Array<{ title: string; count: number }>;
};

const EMPTY: TriggerOptions = { campaigns: [], pipelines: [], brands: [], titles: [] };

export default function OfferTriggersPanel({ onGoToCampaigns }: { onGoToCampaigns?: () => void }) {
  const { user } = useCurrentUser();
  const [triggers, setTriggers] = useState<TriggerRow[]>([]);
  const [options, setOptions] = useState<TriggerOptions>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schemaLag, setSchemaLag] = useState(false);
  const [editing, setEditing] = useState<TriggerRow | 'new' | null>(null);
  const [journal, setJournal] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/campaigns/offer-triggers');
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setError(data?.error || `Lecture impossible (erreur ${res.status}).`);
        setSchemaLag(data?.schemaLag === true);
        return;
      }
      setError(null);
      setSchemaLag(false);
      setTriggers(data.triggers || []);
      setOptions({
        campaigns: data.campaigns || [],
        pipelines: data.pipelines || [],
        brands: data.brands || [],
        titles: data.titles || [],
      });
    } catch (err) {
      setError(`Lecture impossible : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runAll = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/campaigns/offer-triggers/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: user?.name }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Passage impossible', 'error'); return; }
      toast(data.enrolled > 0
        ? `${data.enrolled} contact(s) inscrit(s) · ${data.matched} offre(s) correspondante(s)`
        : `Aucune nouvelle offre à traiter (${data.matched} correspondance(s))`);
      load();
    } finally {
      setRunning(false);
    }
  };

  const toggle = async (trigger: TriggerRow) => {
    const res = await fetch(`/api/campaigns/offer-triggers/${trigger.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !trigger.active }),
    });
    if (!res.ok) { toast('Modification refusée', 'error'); return; }
    toast(trigger.active ? 'Règle mise en pause' : 'Règle réactivée');
    load();
  };

  const remove = async (trigger: TriggerRow) => {
    if (!confirm(
      `Supprimer la règle « ${trigger.name} » ?\n\n`
      + "Les contacts déjà inscrits restent dans leur campagne et les emails déjà "
      + "partis ne sont pas rappelés : la suppression arrête les prochaines "
      + 'détections, elle n\'annule pas le passé.',
    )) return;
    const res = await fetch(`/api/campaigns/offer-triggers/${trigger.id}`, { method: 'DELETE' });
    if (!res.ok) { toast('Suppression impossible', 'error'); return; }
    toast('Règle supprimée');
    load();
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '18px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
        <div style={{ maxWidth: 620 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>
            Détection d&apos;offres → campagne
          </div>
          <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.65 }}>
            Quand une offre correspondant aux termes d&apos;une règle est relevée sur une affaire,
            le contact de cette affaire est inscrit automatiquement dans la campagne choisie.
            La détection a lieu à chaque import d&apos;offres.
          </div>
        </div>
        <button style={{ ...btnDef, marginLeft: 'auto', opacity: running ? 0.6 : 1 }}
          disabled={running} onClick={runAll}>
          {running ? 'Analyse…' : 'Analyser maintenant'}
        </button>
        <button style={btnPri} onClick={() => setEditing('new')}>+ Nouvelle règle</button>
      </div>

      {error && <ReadErrorBanner message={error} schemaLag={schemaLag} onRetry={load} />}

      {loading ? (
        <div style={{ fontSize: 13, color: T.textFaint }}>Chargement…</div>
      ) : error ? null : triggers.length === 0 ? (
        <div style={{
          background: T.surfaceAlt, border: `1px dashed ${T.border}`, borderRadius: 12,
          padding: 28, color: T.textMuted, fontSize: 13, lineHeight: 1.7,
        }}>
          <div style={{ fontWeight: 600, color: T.text, marginBottom: 6 }}>Aucune règle pour l&apos;instant</div>
          Exemple : une règle nommée « Bouchers », avec le terme <code style={code}>boucher</code>,
          pointant vers une campagne dédiée. Dès qu&apos;une offre de boucher est relevée sur une
          affaire, son contact part dans cette campagne.
          {options.campaigns.length === 0 && (
            <div style={{ marginTop: 12, color: '#fbbf24' }}>
              Créez d&apos;abord une campagne de destination.{' '}
              {onGoToCampaigns && (
                <button style={btnXs} onClick={onGoToCampaigns}>Aller aux campagnes</button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {triggers.map(trigger => (
            <div key={trigger.id} style={{
              background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 12,
              padding: '13px 16px', opacity: trigger.active ? 1 : 0.62,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 650 }}>{trigger.name}</span>
                <span style={{
                  padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700,
                  color: trigger.active ? '#4ade80' : '#9aa1b4',
                  background: trigger.active ? 'rgba(74,222,128,.13)' : 'rgba(154,161,180,.13)',
                }}>{trigger.active ? 'ACTIVE' : 'EN PAUSE'}</span>

                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button style={btnXs} onClick={() => setJournal(trigger.id)}>
                    Journal{trigger._count ? ` (${trigger._count.hits})` : ''}
                  </button>
                  <button style={btnXs} onClick={() => setEditing(trigger)}>Modifier</button>
                  <button style={btnXs} onClick={() => toggle(trigger)}>
                    {trigger.active ? 'Mettre en pause' : 'Réactiver'}
                  </button>
                  <button style={btnDanger} onClick={() => remove(trigger)}>Supprimer</button>
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 9 }}>
                {trigger.keywords.split(/[,;\n]+/).map(term => term.trim()).filter(Boolean).map(term => (
                  <span key={term} style={{
                    padding: '2px 9px', borderRadius: 999, fontSize: 11.5,
                    background: 'rgba(59,113,245,.14)', color: '#93b4ff',
                  }}>{term}</span>
                ))}
                {trigger.exclude.split(/[,;\n]+/).map(t => t.trim()).filter(Boolean).map(term => (
                  <span key={`x-${term}`} style={{
                    padding: '2px 9px', borderRadius: 999, fontSize: 11.5,
                    background: 'rgba(248,113,113,.13)', color: '#fca5a5',
                  }}>sauf {term}</span>
                ))}
              </div>

              <div style={{ fontSize: 11.5, color: T.textMuted, display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                <span>→ campagne <strong style={{ color: T.text }}>{trigger.campaign?.name || '—'}</strong></span>
                <span>{trigger.enrolledCount} inscrit(s)</span>
                <span>{trigger.matchedCount} correspondance(s)</span>
                <span>{sinceLabel(trigger.since)}</span>
                <span style={{ color: T.textFaint }}>
                  {trigger.lastRunAt
                    ? `dernier passage ${new Date(trigger.lastRunAt).toLocaleString('fr-FR')}`
                    : 'jamais passée'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{
        marginTop: 20, background: T.surfaceAlt, border: `1px solid ${T.borderSoft}`,
        borderRadius: 10, padding: '13px 16px',
      }}>
        <div style={{ fontSize: 12, fontWeight: 650, marginBottom: 6 }}>
          Variables disponibles dans les emails de ces campagnes
        </div>
        <div style={{ fontSize: 11.5, color: T.textMuted, marginBottom: 9, lineHeight: 1.6 }}>
          L&apos;offre qui a déclenché l&apos;inscription est recopiée sur le lead : la séquence
          peut donc citer l&apos;annonce qui vient de sortir.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 5 }}>
          {OFFER_VARIABLES.map(variable => (
            <div key={variable.name} style={{ fontSize: 11.5, color: T.textMuted }}>
              <code style={code}>{`{{${variable.name}}}`}</code> {variable.description}
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <OfferTriggerModal
          trigger={editing === 'new' ? null : editing}
          options={options}
          userName={user?.name}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {journal && (
        <OfferTriggerJournal triggerId={journal} onClose={() => setJournal(null)} />
      )}
    </div>
  );
}

const code: React.CSSProperties = { color: '#93b4ff', fontSize: 11 };

/**
 * Depuis quand la règle regarde.
 *
 * Une reprise d'historique ramène le plancher à l'époque Unix : afficher
 * « depuis le 01/01/1970 » serait exact et illisible. On dit alors ce que ça
 * veut dire.
 */
export function sinceLabel(since: string): string {
  const date = new Date(since);
  if (Number.isNaN(date.getTime())) return '';
  // Large marge : une base peut stocker l'époque avec un décalage de fuseau.
  if (date.getFullYear() <= 1971) return 'regarde toutes les offres, historique compris';
  return `regarde les offres depuis le ${date.toLocaleDateString('fr-FR')}`;
}
