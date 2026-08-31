'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { InboxOffer, OfferInbox } from '@/types';
import { formatDate } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/lib/currentUser';
import { refreshOfferInbox } from '@/lib/offerInboxClient';

/**
 * Écran de tri des offres reçues de l'automatisation : une case à cocher par
 * offre, exactement le geste qu'on faisait dans l'Excel reçu par email.
 *
 * Utilisé tel quel par la popup (NewOffersModal) et par la page
 * « Offres reçues ». Les offres cochées partent dans l'import normal ; les
 * autres sont écartées et ne seront plus reproposées.
 */

/** Récapitulatif renvoyé par /api/offer-inbox/decide. */
interface DecideResponse {
  imported: number;
  rejected: number;
  import: {
    createdDeals: number;
    updatedDeals: number;
    newOffers: number;
    movedToCall: number;
    errorCount: number;
  } | null;
}

interface Props {
  inboxes: OfferInbox[];
  /** Appelé quand l'utilisateur ferme le récapitulatif de fin de tri. */
  onDone?: () => void;
  /** Bouton de sortie facultatif (« Plus tard » dans la popup). */
  onDismiss?: () => void;
  dismissLabel?: string;
}

const btnPri: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 };
const btnDef: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnDanger: React.CSSProperties = { ...btnDef, color: '#b91c1c', borderColor: '#fecaca', background: '#fef2f2' };
const th: React.CSSProperties = { padding: '7px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '7px 10px', fontSize: 12, borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' };

function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 999, color, background: bg, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}

/** Libellé du magasin : « Enseigne — Magasin », ou l'un des deux si l'autre manque. */
function storeLabel(offer: InboxOffer): string {
  const parts = [offer.brand, offer.storeName].map(s => (s || '').trim()).filter(Boolean);
  if (parts.length === 2 && parts[1].toLowerCase().includes(parts[0].toLowerCase())) return parts[1];
  return parts.join(' — ') || '(magasin non renseigné)';
}

/** Sélection par défaut : tout ce qui n'est pas déjà connu du CRM. Une offre
 *  déjà importée est décochée — on la garde visible pour pouvoir la forcer. */
function defaultSelection(inboxes: OfferInbox[]): Set<string> {
  const set = new Set<string>();
  for (const inbox of inboxes) {
    for (const offer of inbox.offers) if (!offer.knownOffer) set.add(offer.id);
  }
  return set;
}

export default function OfferInboxPanel({ inboxes, onDone, onDismiss, dismissLabel = 'Plus tard' }: Props) {
  const { user } = useCurrentUser();
  const [selected, setSelected] = useState<Set<string>>(() => defaultSelection(inboxes));
  const [busy, setBusy] = useState(false);
  // Récapitulatif affiché à la place de la liste une fois le tri appliqué.
  const [result, setResult] = useState<DecideResponse | null>(null);

  const allOffers = useMemo(() => inboxes.flatMap(i => i.offers), [inboxes]);
  const allIds = useMemo(() => allOffers.map(o => o.id), [allOffers]);

  // Offres déjà présentées à l'utilisateur. Sans cette mémoire, une offre
  // volontairement décochée serait recochée au relevé suivant (60 s plus tard).
  const seenRef = useRef<Set<string>>(new Set(allIds));

  // Un nouveau lot arrive pendant que la popup est ouverte : ses offres
  // rejoignent la sélection par défaut, sans défaire les choix déjà faits.
  useEffect(() => {
    setSelected((prev) => {
      const known = new Set(allIds);
      const next = new Set(Array.from(prev).filter(id => known.has(id)));
      for (const offer of allOffers) {
        if (!seenRef.current.has(offer.id) && !offer.knownOffer) next.add(offer.id);
        seenRef.current.add(offer.id);
      }
      return next;
    });
  }, [allIds, allOffers]);

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleInbox = (inbox: OfferInbox, checked: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    for (const offer of inbox.offers) { if (checked) next.add(offer.id); else next.delete(offer.id); }
    return next;
  });

  const selectedCount = selected.size;
  const rejectedCount = allIds.length - selectedCount;

  const decide = async (importIds: string[], rejectIds: string[], confirmMessage?: string) => {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/offer-inbox/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importIds, rejectIds, decidedBy: user?.name || 'CRM' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);

      setResult(data as DecideResponse);
      await refreshOfferInbox();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const runImport = () => {
    if (selectedCount === 0) {
      toast('Aucune offre cochée.', 'info');
      return;
    }
    const rejectIds = allIds.filter(id => !selected.has(id));
    decide(
      Array.from(selected),
      rejectIds,
      rejectIds.length > 0
        ? `Importer ${selectedCount} offre(s) et écarter les ${rejectIds.length} non cochée(s) ?`
        : undefined,
    );
  };

  const rejectAll = () => decide([], allIds, `Écarter les ${allIds.length} offre(s) reçues ? Elles ne seront plus proposées.`);

  // Tri appliqué : on montre ce qui s'est passé plutôt que de refermer sèchement.
  if (result) {
    const cells: Array<[string, number, string]> = [
      ['Offres importées', result.imported, '#86efac'],
      ['Offres écartées', result.rejected, '#fde047'],
      ['Affaires créées', result.import?.createdDeals ?? 0, '#6ee7b7'],
      ['Affaires mises à jour', result.import?.updatedDeals ?? 0, '#a5f3fc'],
      ['Nouvelles offres', result.import?.newOffers ?? 0, '#c4b5fd'],
      ['Replacées en « À appeler »', result.import?.movedToCall ?? 0, '#f9a8d4'],
    ];
    return (
      <div style={{ background: '#14532d', border: '1px solid #16a34a', borderRadius: 12, padding: 20, color: '#86efac' }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>✓ Tri appliqué</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 14 }}>
          {cells.map(([label, value, color]) => (
            <div key={label}>
              <div style={{ fontSize: 10, color: '#86efac88', marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
            </div>
          ))}
        </div>
        {(result.import?.errorCount ?? 0) > 0 && (
          <div style={{ background: 'rgba(220,38,38,.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#fca5a5', marginBottom: 12 }}>
            ⚠ {result.import?.errorCount} ligne(s) en erreur — détail dans l&apos;historique des imports.
          </div>
        )}
        <button
          style={{ ...btnDef, color: '#86efac', borderColor: '#16a34a', background: 'transparent' }}
          onClick={() => { setResult(null); onDone?.(); }}
        >
          Terminé
        </button>
      </div>
    );
  }

  if (allOffers.length === 0) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
        Aucune offre en attente de tri.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      {/* Barre d'état : ce qui sera importé, ce qui sera écarté. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#334155' }}>
          <strong>{selectedCount}</strong> à importer · <strong>{rejectedCount}</strong> à écarter
          {' '}sur {allIds.length} offre(s) reçue(s)
        </span>
        <div style={{ flex: 1 }} />
        <button style={{ ...btnDef, fontSize: 12, padding: '6px 12px' }} onClick={() => setSelected(new Set(allIds))} disabled={busy}>Tout cocher</button>
        <button style={{ ...btnDef, fontSize: 12, padding: '6px 12px' }} onClick={() => setSelected(new Set())} disabled={busy}>Tout décocher</button>
        <button style={{ ...btnDef, fontSize: 12, padding: '6px 12px' }} onClick={() => setSelected(defaultSelection(inboxes))} disabled={busy}>Nouvelles seulement</button>
      </div>

      {/* Liste des lots reçus */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {inboxes.map((inbox) => {
          const inboxIds = inbox.offers.map(o => o.id);
          const allChecked = inboxIds.length > 0 && inboxIds.every(id => selected.has(id));
          return (
            <div key={inbox.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 10, background: '#fbfdff' }}>
                <input type="checkbox" checked={allChecked} onChange={e => toggleInbox(inbox, e.target.checked)} style={{ cursor: 'pointer' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{inbox.label || 'Offres reçues'}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    Reçu le {formatDate(inbox.receivedAt)} · {inbox.offers.length} offre(s) à trier
                    {inbox.duplicateRows > 0 && ` · ${inbox.duplicateRows} doublon(s) ignoré(s) à la réception`}
                    {inbox.source && ` · ${inbox.source}`}
                  </div>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 32 }} />
                      <th style={th}>Magasin</th>
                      <th style={th}>Ville</th>
                      <th style={th}>Poste</th>
                      <th style={th}>Contrat</th>
                      <th style={th}>Publiée</th>
                      <th style={th}>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inbox.offers.map((offer) => {
                      const checked = selected.has(offer.id);
                      return (
                        <tr key={offer.id} style={{ background: checked ? '#f5f7ff' : '#fff', cursor: 'pointer' }} onClick={() => toggle(offer.id)}>
                          <td style={td}>
                            <input type="checkbox" checked={checked} onChange={() => toggle(offer.id)} onClick={e => e.stopPropagation()} style={{ cursor: 'pointer' }} />
                          </td>
                          <td style={{ ...td, fontWeight: 500 }}>
                            {storeLabel(offer)}
                            {offer.address && <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{offer.address}</div>}
                          </td>
                          <td style={td}>
                            {offer.city || '—'}
                            {(offer.postalCode || offer.department) && (
                              <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{offer.postalCode || offer.department}</div>
                            )}
                          </td>
                          <td style={td}>
                            {offer.jobTitle || offer.offerTitle || '—'}
                            {offer.salary && <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{offer.salary}</div>}
                          </td>
                          <td style={td}>{offer.contractType || '—'}</td>
                          <td style={td}>
                            {offer.publishedAt || '—'}
                            {offer.source && <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{offer.source}</div>}
                          </td>
                          <td style={td}>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                              {offer.knownOffer
                                ? <Badge text="Offre déjà importée" color="#92400e" bg="#fef3c7" />
                                : offer.knownStore
                                  ? <Badge text="Magasin déjà suivi" color="#1e40af" bg="#dbeafe" />
                                  : <Badge text="Nouveau magasin" color="#166534" bg="#dcfce7" />}
                              {offer.url && (
                                <a href={offer.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 11, color: '#4f46e5', textDecoration: 'none' }}>↗</a>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 14, borderTop: '1px solid #e2e8f0', marginTop: 14, flexWrap: 'wrap' }}>
        <button style={{ ...btnPri, opacity: busy ? .6 : 1 }} onClick={runImport} disabled={busy}>
          {busy ? '⟳ Traitement…' : `✓ Importer la sélection (${selectedCount})`}
        </button>
        <button style={btnDanger} onClick={rejectAll} disabled={busy}>Tout écarter</button>
        <div style={{ flex: 1 }} />
        {onDismiss && <button style={btnDef} onClick={onDismiss} disabled={busy}>{dismissLabel}</button>}
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
        Les offres cochées suivent les règles habituelles de l&apos;import : nouveau magasin → affaire en
        « À appeler », magasin déjà suivi + nouvelle offre → retour en « À appeler ». Les offres non
        cochées sont écartées et ne seront plus proposées.
      </div>
    </div>
  );
}
