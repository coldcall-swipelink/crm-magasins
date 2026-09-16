'use client';
// src/components/campaigns/OfferTriggerModal.tsx
//
// Création / modification d'une règle de détection d'offres.
//
// Le point de cet écran est l'APERÇU : à mesure qu'on écrit des termes, il dit
// combien d'offres déjà relevées ils attraperaient, sur combien d'affaires
// distinctes, et en montre quelques-unes. Sans lui, on écrit des termes à
// l'aveugle et on obtient soit une règle qui ne part jamais, soit une règle qui
// attrape tout le magasin — et on ne le découvre qu'une fois les emails partis.

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { parseKeywords } from '@/lib/campaigns/offerMatch';
import type { TriggerOptions, TriggerRow } from './OfferTriggersPanel';
import { T, btnDef, btnPri, btnXs, inp, label, modal, overlay } from './ui';

type Preview = {
  matched: number;
  distinctDeals: number;
  sample: Array<{ title: string; store: string; firstSeenAt: string }>;
};

export default function OfferTriggerModal({ trigger, options, userName, onClose, onSaved }: {
  trigger: TriggerRow | null;
  options: TriggerOptions;
  userName?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(trigger?.name || '');
  const [keywords, setKeywords] = useState(trigger?.keywords || '');
  const [exclude, setExclude] = useState(trigger?.exclude || '');
  const [campaignId, setCampaignId] = useState(trigger?.campaignId || '');
  const [pipelineId, setPipelineId] = useState(trigger?.pipelineId || '');
  const [brandId, setBrandId] = useState(trigger?.brandId || '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  // Aperçu différé : on n'interroge pas le serveur à chaque frappe.
  const runPreview = useCallback(async () => {
    if (parseKeywords(keywords).length === 0) { setPreview(null); return; }
    const res = await fetch('/api/campaigns/offer-triggers/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords, exclude, pipelineId, brandId }),
    });
    const data = await res.json().catch(() => null);
    setPreview(data && !data.error ? data : null);
  }, [keywords, exclude, pipelineId, brandId]);

  useEffect(() => {
    const timer = setTimeout(runPreview, 450);
    return () => clearTimeout(timer);
  }, [runPreview]);

  const save = async () => {
    setBusy(true);
    try {
      const payload = { name, keywords, exclude, campaignId, pipelineId: pipelineId || null, brandId: brandId || null, userName };
      const res = await fetch(
        trigger ? `/api/campaigns/offer-triggers/${trigger.id}` : '/api/campaigns/offer-triggers',
        {
          method: trigger ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Enregistrement refusé', 'error'); return; }
      toast(trigger ? 'Règle mise à jour' : 'Règle créée — elle agira sur les offres à venir');
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  /**
   * Reprise de l'historique : recule le plancher de la règle, ce qui rend
   * éligibles les offres déjà relevées, puis lance un passage.
   *
   * Séparé de l'enregistrement, et chiffré : inscrire d'un coup tous les
   * contacts d'un an d'annonces n'est presque jamais ce qu'on veut, et ne doit
   * jamais arriver par surprise.
   */
  const backfill = async () => {
    if (!trigger) return;
    const count = preview?.distinctDeals ?? 0;
    if (!confirm(
      `Reprendre l'historique des offres pour « ${trigger.name} » ?\n\n`
      + `Environ ${count} affaire(s) sont concernées : leurs contacts seront inscrits `
      + `dans « ${trigger.campaign?.name} » et commenceront à recevoir la séquence.\n\n`
      + 'Les contacts désinscrits, les adresses mortes et ceux déjà inscrits sont ignorés.',
    )) return;

    setBusy(true);
    try {
      const patched = await fetch(`/api/campaigns/offer-triggers/${trigger.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: null }),
      });
      if (!patched.ok) { toast('Reprise impossible', 'error'); return; }

      const res = await fetch('/api/campaigns/offer-triggers/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: trigger.id, userName }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Passage impossible', 'error'); return; }
      toast(`${data.enrolled} contact(s) inscrit(s) depuis l'historique`);
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const terms = parseKeywords(keywords);

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={event => event.stopPropagation()}
        style={{ ...modal, width: 'min(700px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
          {trigger ? 'Modifier la règle' : 'Nouvelle règle de détection'}
        </div>
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 16, lineHeight: 1.6 }}>
          Quand une offre correspondant à ces termes est relevée sur une affaire, le contact de
          cette affaire est inscrit dans la campagne choisie.
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={label}>Nom de la règle</label>
          <input style={inp} autoFocus value={name} placeholder="Offres boucher"
            onChange={event => setName(event.target.value)} />
        </div>

        <div style={{ marginBottom: 4 }}>
          <label style={label}>Termes recherchés</label>
          <input style={inp} value={keywords} placeholder="boucher, boucherie"
            onChange={event => setKeywords(event.target.value)} />
        </div>
        <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 10, lineHeight: 1.6 }}>
          Séparés par des virgules. Cherchés en début de mot, sans tenir compte des accents ni
          de la casse : <code style={code}>boucher</code> trouve aussi <em>bouchère</em>,{' '}
          <em>bouchers</em> et <em>boucherie</em>.
        </div>

        {options.titles.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 5 }}>
              Intitulés les plus fréquents dans vos offres — cliquez pour ajouter :
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 92, overflowY: 'auto' }}>
              {options.titles.map(item => (
                <button key={item.title} style={btnXs}
                  onClick={() => setKeywords(current => (
                    current.trim() ? `${current.replace(/,\s*$/, '')}, ${item.title}` : item.title
                  ))}>
                  {item.title} <span style={{ opacity: 0.6 }}>{item.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 4 }}>
          <label style={label}>Termes exclus (facultatif)</label>
          <input style={inp} value={exclude} placeholder="apprenti, alternance"
            onChange={event => setExclude(event.target.value)} />
        </div>
        <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 14 }}>
          Une offre contenant l&apos;un de ces termes est écartée, même si elle correspond par ailleurs.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
          <div>
            <label style={label}>Campagne de destination</label>
            <select style={inp} value={campaignId} onChange={event => setCampaignId(event.target.value)}>
              <option value="">Choisir…</option>
              {options.campaigns.map(campaign => (
                <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={label}>Pipeline (facultatif)</label>
            <select style={inp} value={pipelineId} onChange={event => setPipelineId(event.target.value)}>
              <option value="">Tous</option>
              {options.pipelines.map(pipeline => (
                <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={label}>Enseigne (facultatif)</label>
            <select style={inp} value={brandId} onChange={event => setBrandId(event.target.value)}>
              <option value="">Toutes</option>
              {options.brands.map(brand => (
                <option key={brand.id} value={brand.id}>{brand.name}</option>
              ))}
            </select>
          </div>
        </div>

        {terms.length > 0 && (
          <div style={{
            background: T.surfaceAlt, border: `1px solid ${T.border}`,
            borderRadius: 10, padding: '12px 15px', marginBottom: 14,
          }}>
            <div style={{ ...label, marginBottom: 7 }}>CE QUE CES TERMES ATTRAPENT</div>
            {!preview ? (
              <div style={{ fontSize: 12, color: T.textFaint }}>Recherche dans les offres…</div>
            ) : preview.matched === 0 ? (
              <div style={{ fontSize: 12, color: '#fbbf24' }}>
                Aucune offre déjà relevée ne correspond. La règle restera sans effet tant qu&apos;une
                annonce de ce type ne sortira pas — vérifiez l&apos;orthographe des termes.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: T.text, marginBottom: 8 }}>
                  <strong>{preview.matched}</strong> offre(s) déjà relevée(s) correspondent, sur{' '}
                  <strong>{preview.distinctDeals}</strong> affaire(s) distinctes.
                </div>
                <div style={{ display: 'grid', gap: 3 }}>
                  {preview.sample.map((item, index) => (
                    <div key={index} style={{ fontSize: 11.5, color: T.textMuted }}>
                      <span style={{ color: T.text }}>{item.title}</span>
                      {item.store && <span style={{ color: T.textFaint }}> · {item.store}</span>}
                      <span style={{ color: T.textFaint }}>
                        {' · '}{new Date(item.firstSeenAt).toLocaleDateString('fr-FR')}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div style={{
          fontSize: 11.5, color: T.textMuted, lineHeight: 1.65, marginBottom: 16,
          borderLeft: `2px solid ${T.border}`, paddingLeft: 11,
        }}>
          {trigger ? (
            new Date(trigger.since).getFullYear() <= 1971 ? (
              <>
                L&apos;historique a été repris : cette règle regarde{' '}
                <strong style={{ color: T.text }}>toutes les offres</strong>, y compris
                les plus anciennes. Celles déjà traitées ne repartiront pas.
              </>
            ) : (
              <>
                Cette règle regarde les offres relevées depuis le{' '}
                <strong style={{ color: T.text }}>
                  {new Date(trigger.since).toLocaleDateString('fr-FR')}
                </strong>. Les offres antérieures sont ignorées.
              </>
            )
          ) : (
            <>
              Une règle neuve ne regarde que les offres <strong style={{ color: T.text }}>à venir</strong> :
              l&apos;enregistrer n&apos;envoie rien tout de suite. La reprise de l&apos;historique
              se demande ensuite, explicitement.
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={{ ...btnPri, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>
            {busy ? 'Enregistrement…' : trigger ? 'Enregistrer' : 'Créer la règle'}
          </button>
          {trigger && (
            <button style={{ ...btnDef, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={backfill}>
              Reprendre l&apos;historique
            </button>
          )}
          <button style={{ ...btnDef, marginLeft: 'auto' }} onClick={onClose}>Annuler</button>
        </div>
      </div>
    </div>
  );
}

const code: React.CSSProperties = { color: '#93b4ff', fontSize: 11 };
