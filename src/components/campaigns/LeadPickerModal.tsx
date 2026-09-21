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
//
// Filtres : l'enseigne, et, pour les leads rattachés à une affaire, le
// pipeline puis les colonnes à retenir — plusieurs à la fois. Le filtre par
// colonnes est le garde-fou contre le double contact : on inscrit les « à
// appeler », pas les « en contact » ni ceux qui ont déjà répondu.

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { LEAD_STATUSES, statusColor, statusLabel } from '@/lib/campaigns/leadFields';
import ColumnPicker from './ColumnPicker';
import { btnDef, btnPri, btnXs, inp, modal, overlay } from './ui';

type Lead = {
  id: string; email: string; civility: string | null; firstName: string | null;
  lastName: string | null; company: string | null; jobTitle: string | null; status: string;
  /** Adresse marquée fausse : jamais inscriptible. */
  badEmail?: boolean;
  /** Étape de l'affaire liée, si le lead vient du CRM (telle que la liste la sert). */
  crm: { dealId: string; pipeline: string; column: string; color: string } | null;
};

/** Un pipeline du CRM et ses étapes, tels que les sert /api/pipelines. */
type PipelineOption = {
  id: string;
  name: string;
  columns: Array<{ id: string; title: string; color: string }>;
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
  // Enseigne : les valeurs présentes dans la recherche, avec leur volume,
  // telles que la liste les renvoie.
  const [companies, setCompanies] = useState<Array<{ name: string; count: number }>>([]);
  const [company, setCompany] = useState('');
  // Périmètre CRM : le pipeline, puis les colonnes retenues (vide = toutes).
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [pipelineId, setPipelineId] = useState('');
  const [columnIds, setColumnIds] = useState<string[]>([]);
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

  // Pipelines et leurs étapes, chargés une fois : ils alimentent le filtre CRM.
  useEffect(() => {
    fetch('/api/pipelines')
      .then(res => res.json())
      .then(data => setPipelines(data.pipelines || []))
      .catch(() => { /* le filtre CRM est un confort : son absence ne bloque rien */ });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set('q', search);
      if (status) params.set('status', status);
      if (company) params.set('company', company);
      if (pipelineId) params.set('pipelineId', pipelineId);
      if (pipelineId && columnIds.length) params.set('columnIds', columnIds.join(','));
      const [list, enrolled] = await Promise.all([
        fetch(`/api/campaigns/leads?${params}`).then(res => res.json()),
        // Qui est déjà dans la campagne ? On ne lit que la page courante des
        // leads, mais l'appel renvoie l'ensemble des inscriptions : c'est
        // suffisant pour griser, et une seule requête.
        fetch(`/api/campaigns/${campaignId}/enrollments?page=1`).then(res => res.json()),
      ]);
      setLeads(list.leads || []);
      setCompanies(list.companies || []);
      setTotal(list.total || 0);
      setPages(list.pages || 1);
      setEnrolledIds(new Set<string>(
        ((enrolled.enrollments || []) as Array<{ lead: { id: string } }>).map(item => item.lead.id),
      ));
    } finally {
      setLoading(false);
    }
  }, [campaignId, page, search, status, company, pipelineId, columnIds]);

  useEffect(() => { load(); }, [load]);

  const columns = pipelines.find(pipeline => pipeline.id === pipelineId)?.columns ?? [];

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
        ? { filter: {
            q: search || undefined,
            status: status || undefined,
            company: company || undefined,
            pipelineId: pipelineId || undefined,
            columnIds: pipelineId && columnIds.length ? columnIds : undefined,
          } }
        : { leadIds: Array.from(selected) };

      const res = await fetch(`/api/campaigns/${campaignId}/enrollments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Inscription impossible', 'error'); return; }

      const reasons = Object.entries(data.reasons || {}).map(([reason, count]) => `${count} ${reason}`).join(', ');
      toast(`${data.enrolled} lead(s) inscrit(s)`
        + (data.skipped ? ` · ${data.skipped} écarté(s) : ${reasons}` : '')
        + (data.sent ? ` · ${data.sent} email(s) déjà parti(s)` : ''));
      // Déjà en cours ailleurs : le moteur espacera leurs emails, donc leur
      // séquence avancera moins vite. Mieux vaut le savoir maintenant.
      if (data.alsoRunningElsewhere > 0) {
        toast(`${data.alsoRunningElsewhere} lead(s) déjà en cours dans une autre campagne : `
          + 'leurs emails seront espacés pour ne pas arriver le même jour.');
      }
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay}
      onClick={onClose}>
      <div onClick={event => event.stopPropagation()} style={{ ...modal, width: 'min(760px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Ajouter depuis mes leads</div>
        <div style={{ fontSize: 12, color: '#9aa1b4', marginBottom: 14 }}>
          Cochez les leads à inscrire, ou inscrivez d&apos;un coup tous ceux qui correspondent
          à la recherche. Les désinscrits et les adresses mortes sont écartés automatiquement.
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input style={{ ...inp, flex: 1 }} placeholder="Rechercher (email, nom, enseigne…)"
            value={query} onChange={event => setQuery(event.target.value)} />
          <select style={{ ...inp, width: 170 }} value={status}
            onChange={event => { setStatus(event.target.value); setPage(1); }}>
            <option value="">Tous les statuts</option>
            {LEAD_STATUSES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <select style={{ ...inp, flex: 1 }} value={company}
            title="Ne garder que les leads de cette enseigne"
            onChange={event => { setCompany(event.target.value); setPage(1); }}>
            <option value="">Toutes les enseignes</option>
            {/* L'enseigne choisie reste listée même si la recherche courante ne
                la contient plus : sinon le sélecteur afficherait une valeur
                absente de ses options. */}
            {company && !companies.some(item => item.name.toLowerCase() === company.toLowerCase()) && (
              <option value={company}>{company}</option>
            )}
            {companies.map(item => (
              <option key={item.name} value={item.name}>{item.name} ({item.count})</option>
            ))}
          </select>
          <select style={{ ...inp, flex: 1 }} value={pipelineId}
            title="Ne garder que les leads rattachés à une affaire de ce pipeline"
            onChange={event => {
              setPipelineId(event.target.value);
              // Les colonnes appartiennent au pipeline : celles de l'ancien
              // laisseraient la liste vide sans qu'on comprenne.
              setColumnIds([]);
              setPage(1);
            }}>
            <option value="">Tous les pipelines</option>
            {pipelines.map(pipeline => (
              <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>
            ))}
          </select>
        </div>

        {/* Toujours affiché : tant qu'aucun pipeline n'est choisi, il dit à
            quoi il sert — sinon on ne devine pas que le filtre existe. */}
        <div style={{ marginBottom: 10 }}>
          <ColumnPicker
            pipelineChosen={pipelineId !== ''}
            compact
            columns={columns}
            selected={columnIds}
            onChange={ids => { setColumnIds(ids); setPage(1); }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #262b38', borderRadius: 9, minHeight: 200 }}>
          {loading ? (
            <div style={{ padding: 16, fontSize: 12.5, color: '#6b7283' }}>Chargement…</div>
          ) : leads.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12.5, color: '#6b7283' }}>Aucun lead ne correspond.</div>
          ) : leads.map(lead => {
            // Adresse fausse : ni cochable ni inscriptible, et on dit pourquoi.
            const already = enrolledIds.has(lead.id) || Boolean(lead.badEmail);
            return (
              <label key={lead.id} style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '7px 11px',
                borderBottom: '1px solid #1c1f2a', fontSize: 12.5,
                opacity: already ? 0.45 : 1, cursor: already ? 'default' : 'pointer',
              }}>
                <input type="checkbox" disabled={already} checked={selected.has(lead.id)}
                  onChange={() => toggle(lead.id)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>
                    {[lead.civility, lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email}
                    {lead.badEmail
                      ? <span style={{ marginLeft: 7, fontSize: 11, color: '#f87171' }}>mauvais email</span>
                      : already && <span style={{ marginLeft: 7, fontSize: 11, color: '#6b7283' }}>déjà dans la campagne</span>}
                  </div>
                  <div style={{ color: '#6b7283', fontSize: 11.5 }}>
                    {lead.email}{lead.company ? ` · ${lead.company}` : ''}{lead.jobTitle ? ` · ${lead.jobTitle}` : ''}
                  </div>
                </div>
                {lead.crm && (
                  <span title={`Affaire dans « ${lead.crm.pipeline} »`} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '1px 7px', borderRadius: 999,
                    fontSize: 10.5, fontWeight: 600, color: '#9aa1b4', background: '#1c1f2a', whiteSpace: 'nowrap',
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: lead.crm.color }} />
                    {lead.crm.column}
                  </span>
                )}
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
              <span style={{ fontSize: 11.5, color: '#9aa1b4' }}>page {page} / {pages}</span>
              <button style={btnXs} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>›</button>
            </>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9aa1b4' }}>
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
