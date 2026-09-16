'use client';
// src/components/campaigns/LeadPickerModal.tsx
//
// Choix de leads existants à inscrire dans une campagne.
//
// Deux façons de sélectionner, parce que les deux besoins existent :
//   • à la main, en cochant — on voit exactement qui part ;
//   • « tous ceux qui correspondent au filtre », pour inscrire 3 000 leads
//     sans les cocher un par un.
//
// Les leads déjà inscrits dans la campagne sont affichés grisés plutôt que
// masqués : sinon on cherche en vain un lead qu'on a déjà ajouté.

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { LEAD_STATUSES, statusColor, statusLabel } from '@/lib/campaigns/leadFields';
import { btnDef, btnPri, btnXs, card, inp, label } from './ui';

type Lead = {
  id: string; email: string; civility: string | null; firstName: string | null;
  lastName: string | null; company: string | null; jobTitle: string | null; status: string;
};

export default function LeadPickerModal({ campaignId, onClose, onDone }: {
  campaignId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [enrolledIds, setEnrolledIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Recherche différée, comme dans la liste des leads.
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set('q', search);
      if (status) params.set('status', status);
      const [list, enrolled] = await Promise.all([
        fetch(`/api/campaigns/leads?${params}`).then(res => res.json()),
        // Qui est déjà dans la campagne ? On ne lit que la page courante des
        // leads, mais l'appel renvoie l'ensemble des inscriptions : c'est
        // suffisant pour griser, et une seule requête.
        fetch(`/api/campaigns/${campaignId}/enrollments?page=1`).then(res => res.json()),
      ]);
      setLeads(list.leads || []);
      setTotal(list.total || 0);
      setPages(list.pages || 1);
      setEnrolledIds(new Set<string>(
        ((enrolled.enrollments || []) as Array<{ lead: { id: string } }>).map(item => item.lead.id),
      ));
    } finally {
      setLoading(false);
    }
  }, [campaignId, page, search, status]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /** Coche (ou décoche) tous les leads visibles sur la page. */
  const togglePage = () => {
    const selectable = leads.filter(lead => !enrolledIds.has(lead.id)).map(lead => lead.id);
    const allPicked = selectable.every(id => selected.has(id));
    setSelected(current => {
      const next = new Set(current);
      for (const id of selectable) { if (allPicked) next.delete(id); else next.add(id); }
      return next;
    });
  };

  const enroll = async (useFilter: boolean) => {
    setBusy(true);
    try {
      const body = useFilter
        ? { filter: { q: search || undefined, status: status || undefined } }
        : { leadIds: Array.from(selected) };

      const res = await fetch(`/api/campaigns/${campaignId}/enrollments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Inscription impossible', 'error'); return; }

      const reasons = Object.entries(data.reasons || {}).map(([reason, count]) => `${count} ${reason}`).join(', ');
      toast(`${data.enrolled} lead(s) inscrit(s)${data.skipped ? ` · ${data.skipped} écarté(s) : ${reasons}` : ''}`);
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 24 }}
      onClick={onClose}>
      <div onClick={event => event.stopPropagation()} style={{ ...card, width: 'min(760px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Ajouter depuis mes leads</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
          Cochez les leads à inscrire, ou inscrivez d&apos;un coup tous ceux qui correspondent
          à la recherche. Les désinscrits et les adresses mortes sont écartés automatiquement.
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input style={{ ...inp, flex: 1 }} placeholder="Rechercher (email, nom, enseigne…)"
            value={query} onChange={event => setQuery(event.target.value)} />
          <select style={{ ...inp, width: 190 }} value={status}
            onChange={event => { setStatus(event.target.value); setPage(1); }}>
            <option value="">Tous les statuts</option>
            {LEAD_STATUSES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 9, minHeight: 200 }}>
          {loading ? (
            <div style={{ padding: 16, fontSize: 12.5, color: '#94a3b8' }}>Chargement…</div>
          ) : leads.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12.5, color: '#94a3b8' }}>Aucun lead ne correspond.</div>
          ) : leads.map(lead => {
            const already = enrolledIds.has(lead.id);
            return (
              <label key={lead.id} style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '7px 11px',
                borderBottom: '1px solid #f8fafc', fontSize: 12.5,
                opacity: already ? 0.45 : 1, cursor: already ? 'default' : 'pointer',
              }}>
                <input type="checkbox" disabled={already} checked={selected.has(lead.id)}
                  onChange={() => toggle(lead.id)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>
                    {[lead.civility, lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email}
                    {already && <span style={{ marginLeft: 7, fontSize: 11, color: '#94a3b8' }}>déjà dans la campagne</span>}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 11.5 }}>
                    {lead.email}{lead.company ? ` · ${lead.company}` : ''}{lead.jobTitle ? ` · ${lead.jobTitle}` : ''}
                  </div>
                </div>
                <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, color: statusColor(lead.status), background: `${statusColor(lead.status)}18` }}>
                  {statusLabel(lead.status)}
                </span>
              </label>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <button style={btnXs} onClick={togglePage}>Tout cocher sur cette page</button>
          {pages > 1 && (
            <>
              <button style={btnXs} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
              <span style={{ fontSize: 11.5, color: '#64748b' }}>page {page} / {pages}</span>
              <button style={btnXs} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>›</button>
            </>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
            {selected.size} sélectionné(s) · {total} lead(s) dans la recherche
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button style={{ ...btnPri, opacity: busy || selected.size === 0 ? 0.6 : 1 }}
            disabled={busy || selected.size === 0} onClick={() => enroll(false)}>
            Inscrire les {selected.size} leads cochés
          </button>
          <button style={{ ...btnDef, opacity: busy || total === 0 ? 0.6 : 1 }} disabled={busy || total === 0}
            onClick={() => enroll(true)}>
            Inscrire les {total} leads de la recherche
          </button>
          <button style={{ ...btnDef, marginLeft: 'auto' }} onClick={onClose}>Annuler</button>
        </div>
      </div>
    </div>
  );
}
