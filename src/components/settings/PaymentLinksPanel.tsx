'use client';
// src/components/settings/PaymentLinksPanel.tsx
//
// Paramétrage des liens de paiement (Paramètres). C'est ici qu'on décide de ce
// que verra le commercial au moment d'envoyer un lien depuis une affaire :
//
//   - la CATÉGORIE : « classiques » (les offres standard, en tête de liste) ou
//     « spéciaux » (les liens créés pour un seul client) ;
//   - le LIBELLÉ affiché dans le CRM, indépendant du nom produit vu par le
//     client sur la page de paiement ;
//   - l'ORDRE à l'intérieur de chaque catégorie ;
//   - le MASQUAGE, pour sortir un lien du sélecteur sans le désactiver sur Stripe.
//
// Les liens eux-mêmes viennent toujours de Stripe : rien ne se crée ni ne se
// supprime ici. Un lien nouvellement créé sur Stripe apparaît automatiquement
// en bas des « spéciaux », immédiatement utilisable.
//
// L'enregistrement se fait en bloc (bouton « Enregistrer »), parce qu'un
// réordonnancement touche par nature plusieurs liens à la fois.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/ui/Toast';

const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: 13, outline: 'none' };
const btnPri: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnDef: React.CSSProperties = { padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#334155', fontWeight: 500, cursor: 'pointer', fontSize: 13 };
const btnXs: React.CSSProperties = { padding: '3px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#334155', cursor: 'pointer', fontSize: 11 };

type Category = 'classique' | 'special';

interface PaymentLink {
  id: string;
  url: string;
  name: string;
  stripeName: string;
  displayName: string;
  amountLabel: string;
  category: Category;
  position: number;
  hidden: boolean;
  configured: boolean;
}

/** Ordonne les liens d'une catégorie tels qu'ils sont affichés dans la liste. */
function ofCategory(links: PaymentLink[], category: Category): PaymentLink[] {
  return links.filter(l => l.category === category);
}

export default function PaymentLinksPanel() {
  // `links` est l'état de travail : son ORDRE dans le tableau fait foi pour
  // chaque catégorie (la position enregistrée sera l'index dans sa catégorie).
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/payment-links');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Erreur de chargement des liens de paiement.'); return; }
      setLinks(Array.isArray(data.links) ? data.links : []);
      setDirty(false);
    } catch {
      setError('Erreur réseau lors du chargement des liens Stripe.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const classiques = useMemo(() => ofCategory(links, 'classique'), [links]);
  const specials = useMemo(() => ofCategory(links, 'special'), [links]);

  const normalizedSearch = search.trim().toLowerCase();
  const matches = (l: PaymentLink) =>
    !normalizedSearch
    || l.name.toLowerCase().includes(normalizedSearch)
    || l.stripeName.toLowerCase().includes(normalizedSearch)
    || l.amountLabel.toLowerCase().includes(normalizedSearch);

  const patch = (id: string, changes: Partial<PaymentLink>) => {
    setLinks(prev => prev.map(l => (l.id === id ? { ...l, ...changes } : l)));
    setDirty(true);
  };

  /**
   * Bascule un lien d'une catégorie à l'autre. Il est retiré de sa liste et
   * ajouté EN FIN de la liste d'arrivée : on ne devine pas où l'utilisateur
   * voudrait le voir, il le remonte ensuite s'il le souhaite.
   */
  const switchCategory = (id: string) => {
    setLinks(prev => {
      const link = prev.find(l => l.id === id);
      if (!link) return prev;
      const target: Category = link.category === 'classique' ? 'special' : 'classique';
      return [...prev.filter(l => l.id !== id), { ...link, category: target }];
    });
    setDirty(true);
  };

  /** Monte / descend un lien à l'intérieur de sa catégorie. */
  const move = (id: string, direction: -1 | 1) => {
    setLinks(prev => {
      const link = prev.find(l => l.id === id);
      if (!link) return prev;
      const siblings = ofCategory(prev, link.category);
      const from = siblings.findIndex(l => l.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= siblings.length) return prev;

      const reordered = [...siblings];
      [reordered[from], reordered[to]] = [reordered[to], reordered[from]];

      // On réinjecte la catégorie réordonnée à la place des anciens éléments,
      // sans toucher à l'autre catégorie.
      const others = prev.filter(l => l.category !== link.category);
      return link.category === 'classique' ? [...reordered, ...others] : [...others, ...reordered];
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      // La position enregistrée = le rang affiché dans sa catégorie.
      const items = (['classique', 'special'] as Category[]).flatMap(cat =>
        ofCategory(links, cat).map((l, index) => ({
          stripeLinkId: l.id,
          category: l.category,
          displayName: l.displayName.trim(),
          position: index,
          hidden: l.hidden,
        })),
      );
      const res = await fetch('/api/payment-links', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erreur');
      toast('✓ Liens de paiement enregistrés');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Échec de l\'enregistrement', 'error');
    } finally {
      setSaving(false);
    }
  };

  const renderRow = (link: PaymentLink, index: number, siblings: PaymentLink[]) => (
    <div
      key={link.id}
      style={{
        // `flexWrap` : la colonne des Paramètres est étroite ; les commandes
        // passent sous le libellé plutôt que de l'écraser.
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        background: link.hidden ? '#f8fafc' : '#fff',
        border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', marginBottom: 6,
        opacity: link.hidden ? 0.6 : 1,
      }}
    >
      <span style={{ fontSize: 11, color: '#94a3b8', width: 20, textAlign: 'right', flexShrink: 0 }}>{index + 1}</span>

      <input
        style={{ ...inp, flex: '1 1 200px', minWidth: 160, width: 'auto' }}
        value={link.displayName}
        placeholder={link.stripeName}
        title={`Nom du produit sur Stripe : ${link.stripeName}`}
        onChange={e => patch(link.id, { displayName: e.target.value })}
      />

      <span style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', flexShrink: 0, minWidth: 90, textAlign: 'right' }}>
        {link.amountLabel || '—'}
      </span>

      <button
        style={{ ...btnXs, opacity: index === 0 ? 0.4 : 1, cursor: index === 0 ? 'not-allowed' : 'pointer' }}
        onClick={() => move(link.id, -1)} disabled={index === 0} title="Monter"
      >↑</button>
      <button
        style={{ ...btnXs, opacity: index === siblings.length - 1 ? 0.4 : 1, cursor: index === siblings.length - 1 ? 'not-allowed' : 'pointer' }}
        onClick={() => move(link.id, 1)} disabled={index === siblings.length - 1} title="Descendre"
      >↓</button>
      <button
        style={btnXs}
        onClick={() => switchCategory(link.id)}
        title={link.category === 'classique' ? 'Basculer dans les liens spéciaux' : 'Basculer dans les liens classiques'}
      >{link.category === 'classique' ? '→ Spécial' : '→ Classique'}</button>
      <button
        style={btnXs}
        onClick={() => patch(link.id, { hidden: !link.hidden })}
        title={link.hidden ? 'Réafficher dans le sélecteur' : 'Masquer du sélecteur (le lien reste actif sur Stripe)'}
      >{link.hidden ? '🚫' : '👁'}</button>
    </div>
  );

  /** Une catégorie : son titre, son explication et ses lignes. */
  const renderSection = (title: string, hint: string, category: Category, siblings: PaymentLink[]) => {
    const visible = siblings.filter(matches);
    return (
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>
          {title} <span style={{ color: '#94a3b8', fontWeight: 500 }}>({siblings.length})</span>
        </div>
        <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 8 }}>{hint}</div>
        {siblings.length === 0 && (
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 6 }}>
            {category === 'classique'
              ? 'Aucun lien classique. Utilisez « → Classique » sur les liens concernés.'
              : 'Aucun lien spécial.'}
          </div>
        )}
        {siblings.length > 0 && visible.length === 0 && (
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 6 }}>Aucun lien ne correspond à la recherche.</div>
        )}
        {visible.map(l => renderRow(l, siblings.indexOf(l), siblings))}
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
        Organise le sélecteur « Envoyer un lien de paiement » des affaires : les <b>classiques</b> apparaissent en
        premier, les <b>spéciaux</b> (créés pour un seul client) sont regroupés en dessous. Le libellé saisi ici n&apos;est
        visible que dans le CRM — le client voit toujours le nom du produit Stripe. Les liens viennent de Stripe :
        un nouveau lien arrive automatiquement en bas des spéciaux.
      </p>

      {loading ? (
        <div style={{ fontSize: 12.5, color: '#4f46e5' }}>⟳ Chargement des liens Stripe…</div>
      ) : error ? (
        <div style={{ fontSize: 12.5, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>{error}</span>
          <button onClick={load} style={{ ...btnDef, padding: '2px 8px', fontSize: 11 }}>Réessayer</button>
        </div>
      ) : links.length === 0 ? (
        <div style={{ fontSize: 12.5, color: '#94a3b8' }}>Aucun lien de paiement actif sur Stripe.</div>
      ) : (
        <>
          <input
            style={{ ...inp, background: '#fff', marginBottom: 14 }}
            placeholder="Rechercher un lien…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {normalizedSearch && (
            <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 10 }}>
              Recherche active : les numéros et les flèches restent ceux de la liste complète.
            </div>
          )}

          {renderSection('Liens classiques', 'Vos offres standard, proposées en premier lors d\'un envoi.', 'classique', classiques)}
          {renderSection('Liens spéciaux', 'Liens créés pour un client précis. Regroupés et repliés dans le sélecteur.', 'special', specials)}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              style={{ ...btnPri, opacity: saving || !dirty ? 0.6 : 1, cursor: saving || !dirty ? 'not-allowed' : 'pointer' }}
              onClick={save} disabled={saving || !dirty}
            >{saving ? '⟳ Enregistrement…' : 'Enregistrer'}</button>
            <button
              style={{ ...btnDef, opacity: saving || !dirty ? 0.6 : 1, cursor: saving || !dirty ? 'not-allowed' : 'pointer' }}
              onClick={load} disabled={saving || !dirty}
            >Annuler</button>
          </div>
        </>
      )}
    </div>
  );
}
