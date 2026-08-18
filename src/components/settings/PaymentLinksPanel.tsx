'use client';
// src/components/settings/PaymentLinksPanel.tsx
//
// Paramétrage des liens de paiement (Paramètres).
//
// L'écran affiche le PLAN TARIFAIRE en dur — 7 offres × 2 jeux de tarifs × 3
// modes de paiement, soit 42 cases toujours présentes, dans le même ordre. Pour
// chaque case, une liste déroulante désigne le Payment Link Stripe qui lui
// correspond. Rien ne se crée ni ne se supprime ici : on attribue.
//
// Ce qui n'est attribué à aucune case est automatiquement un « lien spécial »
// (créé pour un seul client) ; ces liens sont rappelés en bas, pour information.
//
// L'enregistrement se fait en bloc : le plan part d'un coup, cohérent.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { PAYMENT_OFFERS, PAYMENT_TARIFFS } from '@/lib/paymentLinkSlots';

const inp: React.CSSProperties = { width: '100%', padding: '6px 9px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a', fontSize: 12.5, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnDef: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 13 };

interface CatalogLink { id: string; url: string; name: string; amountLabel: string; }
interface Slot {
  slotKey: string;
  offerKey: string; offerLabel: string;
  tariffKey: string; tariffLabel: string;
  modeKey: string; modeLabel: string;
  fullLabel: string;
  link: CatalogLink | null;
}

/** « Abonnement Premium — 1 200,00 €/mois », pour les options des listes. */
function linkOptionLabel(l: CatalogLink): string {
  return l.amountLabel ? `${l.name} — ${l.amountLabel}` : l.name;
}

/**
 * Un Payment Link n'a pas de nom propre chez Stripe : il est désigné par ses
 * produits. Deux liens distincts peuvent donc porter exactement le même
 * intitulé (même produit, même prix). Dans ce cas seulement, on ajoute la fin
 * de l'identifiant Stripe pour pouvoir les distinguer dans la liste.
 */
function buildOptionLabels(links: CatalogLink[]): Record<string, string> {
  const counts: Record<string, number> = {};
  for (const l of links) {
    const base = linkOptionLabel(l);
    counts[base] = (counts[base] || 0) + 1;
  }
  const labels: Record<string, string> = {};
  for (const l of links) {
    const base = linkOptionLabel(l);
    labels[l.id] = counts[base] > 1 ? `${base} · …${l.id.slice(-6)}` : base;
  }
  return labels;
}

export default function PaymentLinksPanel() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [allLinks, setAllLinks] = useState<CatalogLink[]>([]);
  const [specials, setSpecials] = useState<CatalogLink[]>([]);
  // Attributions en cours d'édition : clé de case → id de lien ('' = case vide).
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Les anciens tarifs ne servent qu'aux clients historiques : repliés par défaut.
  const [showOldTariffs, setShowOldTariffs] = useState(false);

  // `refresh` force la relecture des libellés chez Stripe : ils sont mis en cache
  // quelques minutes côté serveur pour ne pas déclencher son rate limit.
  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/payment-links${refresh ? '?refresh=1' : ''}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Erreur de chargement des liens de paiement.'); return; }
      const loaded: Slot[] = Array.isArray(data.slots) ? data.slots : [];
      setSlots(loaded);
      setAllLinks(Array.isArray(data.allLinks) ? data.allLinks : []);
      setSpecials(Array.isArray(data.specials) ? data.specials : []);
      setDraft(Object.fromEntries(loaded.map(s => [s.slotKey, s.link?.id || ''])));
      setDirty(false);
    } catch {
      setError('Erreur réseau lors du chargement des liens Stripe.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const assignedCount = useMemo(() => Object.values(draft).filter(Boolean).length, [draft]);

  // Intitulés des options, avec suffixe d'identifiant sur les seuls doublons.
  const optionLabels = useMemo(() => buildOptionLabels(allLinks), [allLinks]);

  // Un même lien attribué à plusieurs cases n'est pas interdit (deux cases
  // peuvent légitimement pointer le même tarif), mais c'est le plus souvent une
  // erreur de saisie : on le signale.
  const duplicates = useMemo(() => {
    const seen: Record<string, number> = {};
    for (const id of Object.values(draft)) if (id) seen[id] = (seen[id] || 0) + 1;
    return new Set(Object.keys(seen).filter(id => seen[id] > 1));
  }, [draft]);

  const assign = (slotKey: string, linkId: string) => {
    setDraft(d => ({ ...d, [slotKey]: linkId }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/payment-links', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignments: slots.map(s => ({ slotKey: s.slotKey, stripeLinkId: draft[s.slotKey] || '' })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erreur');
      toast('✓ Plan tarifaire enregistré');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Échec de l\'enregistrement', 'error');
    } finally {
      setSaving(false);
    }
  };

  /** Une case : son intitulé et la liste déroulante des liens Stripe. */
  const renderSlot = (slot: Slot) => {
    const value = draft[slot.slotKey] || '';
    const duplicated = Boolean(value) && duplicates.has(value);
    return (
      <div key={slot.slotKey} style={{ display: 'grid', gridTemplateColumns: '1fr 1.35fr', gap: 8, alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 12.5, color: value ? '#0f172a' : '#94a3b8', fontWeight: value ? 500 : 400 }}>
          {value ? '' : '○ '}{slot.modeLabel}
        </span>
        <select
          style={{ ...inp, cursor: 'pointer', borderColor: duplicated ? '#fbbf24' : value ? '#c7d2fe' : '#e2e8f0', background: value ? '#fff' : '#f8fafc' }}
          value={value}
          onChange={e => assign(slot.slotKey, e.target.value)}
          title={duplicated ? 'Ce lien est déjà attribué à une autre case' : slot.fullLabel}
        >
          <option value="">— Aucun lien —</option>
          {allLinks.map(l => <option key={l.id} value={l.id}>{optionLabels[l.id]}</option>)}
        </select>
      </div>
    );
  };

  /** Un jeu de tarifs (actuels / anciens) à l'intérieur d'une offre. */
  const renderTariff = (offerKey: string, tariffKey: string, tariffLabel: string) => {
    const rows = slots.filter(s => s.offerKey === offerKey && s.tariffKey === tariffKey);
    const filled = rows.filter(s => draft[s.slotKey]).length;
    return (
      <div key={tariffKey} style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 5 }}>
          {tariffLabel} <span style={{ fontWeight: 500, color: filled === rows.length ? '#16a34a' : '#94a3b8' }}>({filled}/{rows.length})</span>
        </div>
        {rows.map(renderSlot)}
      </div>
    );
  };

  /** Une offre : ses tarifs actuels, et ses anciens tarifs si dépliés. */
  const renderOffer = (offerKey: string, offerLabel: string) => {
    const rows = slots.filter(s => s.offerKey === offerKey);
    const filled = rows.filter(s => draft[s.slotKey]).length;
    return (
      <div key={offerKey} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginBottom: 10, background: '#fff' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#4f46e5', marginBottom: 8 }}>
          {offerLabel} <span style={{ fontWeight: 500, color: '#94a3b8' }}>({filled}/{rows.length} attribuées)</span>
        </div>
        {PAYMENT_TARIFFS
          .filter(t => t.key === 'actuel' || showOldTariffs)
          .map(t => renderTariff(offerKey, t.key, t.label))}
      </div>
    );
  };

  return (
    <div style={{ marginBottom: 28, border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, background: '#f8fafc' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>💳 Liens de paiement</div>
        {dirty && <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>Modifications non enregistrées</span>}
      </div>
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
        Le plan tarifaire est fixe : pour chaque offre, chaque jeu de tarifs et chaque mode de paiement, désignez le
        lien Stripe correspondant. C&apos;est ce plan que le commercial parcourt en trois listes déroulantes au moment
        d&apos;envoyer un lien. Tout lien Stripe actif <b>non attribué</b> ici devient automatiquement un
        <b> lien spécial</b>, proposé à part.
      </p>

      {loading ? (
        <div style={{ fontSize: 12.5, color: '#4f46e5' }}>⟳ Chargement des liens Stripe…</div>
      ) : error ? (
        <div style={{ fontSize: 12.5, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>{error}</span>
          <button onClick={() => load(false)} style={{ ...btnDef, padding: '2px 8px', fontSize: 11 }}>Réessayer</button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#334155' }}>
              <b>{assignedCount}</b> / {slots.length} cases attribuées
            </span>
            <label style={{ fontSize: 12, color: '#334155', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input type="checkbox" checked={showOldTariffs} onChange={e => setShowOldTariffs(e.target.checked)} />
              Afficher les anciens tarifs
            </label>
            <button
              style={{ ...btnDef, padding: '3px 10px', fontSize: 11.5, marginLeft: 'auto' }}
              onClick={() => load(true)}
              disabled={loading}
              title="Relit les noms et montants chez Stripe (après un renommage de produit)"
            >↻ Rafraîchir depuis Stripe</button>
          </div>

          {allLinks.length === 0 && (
            <div style={{ fontSize: 12.5, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
              Aucun lien de paiement actif sur Stripe : les listes déroulantes sont vides.
            </div>
          )}

          {duplicates.size > 0 && (
            <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
              ⚠ {duplicates.size} lien(s) attribué(s) à plusieurs cases (encadrés en orange). C&apos;est autorisé, mais
              vérifiez qu&apos;il ne s&apos;agit pas d&apos;une erreur.
            </div>
          )}

          {PAYMENT_OFFERS.map(o => renderOffer(o.key, o.label))}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
            <button
              style={{ ...btnPri, opacity: saving || !dirty ? 0.6 : 1, cursor: saving || !dirty ? 'not-allowed' : 'pointer' }}
              onClick={save} disabled={saving || !dirty}
            >{saving ? '⟳ Enregistrement…' : 'Enregistrer le plan'}</button>
            <button
              style={{ ...btnDef, opacity: saving || !dirty ? 0.6 : 1, cursor: saving || !dirty ? 'not-allowed' : 'pointer' }}
              onClick={() => load(false)} disabled={saving || !dirty}
            >Annuler</button>
          </div>

          {/* Rappel : ce qui n'est attribué nulle part est un lien spécial. */}
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
              Liens spéciaux <span style={{ fontWeight: 500, color: '#94a3b8' }}>({specials.length})</span>
            </div>
            <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 8 }}>
              Liens actifs sur Stripe n&apos;occupant aucune case. Proposés à part, avec recherche, lors d&apos;un envoi.
              Cette liste se met à jour après enregistrement.
            </div>
            {specials.length === 0 ? (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>Aucun — tous les liens actifs occupent une case.</div>
            ) : (
              <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                {specials.map(l => (
                  <div key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#334155', padding: '3px 0' }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                    <span style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>{l.amountLabel || '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
