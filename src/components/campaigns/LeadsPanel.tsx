'use client';
// src/components/campaigns/LeadsPanel.tsx
//
// Écran « Leads » de l'onglet Campagnes : la liste de tous les contacts
// prospectés, filtrable par statut, par recherche, par enseigne, par poste et
// par situation dans le CRM (pipeline et étape de l'affaire), avec ouverture
// de la fiche sur le côté pour le suivi un par un.
//
// La colonne « Étape CRM » distingue deux choses : l'affaire dont le lead
// VIENT (rattachement explicite) et l'affaire qui lui RESSEMBLE — même
// enseigne, même ville. La seconde est le garde-fou contre le mail écrit à un
// magasin qu'on a déjà au téléphone.

import { useCallback, useEffect, useState } from 'react';
import { useCurrentUser } from '@/lib/currentUser';
import { toast } from '@/components/ui/Toast';
import { LEAD_STATUSES, statusColor, statusLabel } from '@/lib/campaigns/leadFields';
import LeadDrawer, { type LeadRow } from './LeadDrawer';
import DealImportModal from './DealImportModal';
import EnrollInCampaignModal from './EnrollInCampaignModal';
import LeadFormModal from './LeadFormModal';
import LeadImportModal from './LeadImportModal';
import ReadErrorBanner from './ReadErrorBanner';
import { T, btnDanger, btnDef, btnPri, btnXs, inp } from './ui';


/** Un pipeline du CRM et ses étapes, tels que les sert /api/pipelines. */
type PipelineOption = {
  id: string;
  name: string;
  columns: Array<{ id: string; title: string; color: string }>;
};

export default function LeadsPanel() {
  const { user } = useCurrentUser();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  // Situation dans le CRM : le pipeline, puis l'étape à l'intérieur de ce
  // pipeline. Les étapes n'ont de sens qu'une fois le pipeline choisi (deux
  // pipelines peuvent avoir une étape du même nom).
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [pipelineId, setPipelineId] = useState('');
  const [columnId, setColumnId] = useState('');
  // Enseigne : les valeurs présentes dans la recherche, avec leur volume,
  // telles que la liste les renvoie.
  const [companies, setCompanies] = useState<Array<{ name: string; count: number }>>([]);
  const [company, setCompany] = useState('');
  // Poste : mêmes règles que l'enseigne — les valeurs présentes, avec leur volume.
  const [jobTitles, setJobTitles] = useState<Array<{ name: string; count: number }>>([]);
  const [jobTitle, setJobTitle] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  // Message d'erreur de la dernière lecture. Une liste vide et une lecture
  // tombée se ressemblent à l'écran : il faut les distinguer, sinon une panne
  // se lit comme une perte de données.
  const [error, setError] = useState<string | null>(null);
  const [schemaLag, setSchemaLag] = useState(false);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [fromCrm, setFromCrm] = useState(false);
  // Sélection multiple : les identifiants cochés, toutes pages confondues.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  // Envoi des leads cochés (ou de toute la recherche) vers une campagne.
  const [enrolling, setEnrolling] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set('status', status);
      if (search) params.set('q', search);
      if (company) params.set('company', company);
      if (jobTitle) params.set('jobTitle', jobTitle);
      if (pipelineId) params.set('pipelineId', pipelineId);
      if (columnId) params.set('columnId', columnId);
      const res = await fetch(`/api/campaigns/leads?${params}`);
      const data = await res.json().catch(() => null);

      if (!res.ok || !data) {
        // On ne touche pas à la liste affichée : mieux vaut laisser la
        // précédente à l'écran, avec le bandeau d'erreur, que de la vider.
        setError(data?.error || `Lecture des leads impossible (erreur ${res.status}).`);
        setSchemaLag(data?.schemaLag === true);
        return;
      }

      setError(null);
      setSchemaLag(false);
      setLeads(data.leads || []);
      setCounts(data.statusCounts || {});
      setCompanies(data.companies || []);
      setJobTitles(data.jobTitles || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (err) {
      setError(`Lecture des leads impossible : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [page, status, search, company, jobTitle, pipelineId, columnId]);

  useEffect(() => { load(); }, [load]);

  // Pipelines et leurs étapes, chargés une fois : ils alimentent les deux
  // listes déroulantes du filtre CRM.
  useEffect(() => {
    fetch('/api/pipelines')
      .then(res => res.json())
      .then(data => setPipelines(data.pipelines || []))
      .catch(() => { /* le filtre CRM est un confort : son absence ne bloque rien */ });
  }, []);

  // Recherche différée : on n'interroge pas le serveur à chaque frappe.
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const totalAll = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const columns = pipelines.find(pipeline => pipeline.id === pipelineId)?.columns ?? [];

  const toggle = (id: string) => setPicked(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /** Coche ou décoche toute la page affichée. */
  const togglePage = () => {
    const ids = leads.map(lead => lead.id);
    const allPicked = ids.every(id => picked.has(id));
    setPicked(current => {
      const next = new Set(current);
      for (const id of ids) { if (allPicked) next.delete(id); else next.add(id); }
      return next;
    });
  };

  const removePicked = async () => {
    const ids = Array.from(picked);
    if (ids.length === 0) return;
    // Suppression irréversible : on annonce ce qu'elle emporte avant, pas après.
    if (!confirm(
      `Supprimer ${ids.length} lead(s) ?\n\n`
      + 'Leurs notes, leur historique, leurs inscriptions en campagne et les emails '
      + 'qui leur ont été envoyés seront supprimés avec eux. Cette action est définitive.',
    )) return;

    setDeleting(true);
    try {
      const res = await fetch('/api/campaigns/leads/bulk-delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Suppression impossible', 'error'); return; }

      toast(`${data.deleted} lead(s) supprimé(s)`
        + (data.enrollments ? ` · ${data.enrollments} inscription(s)` : '')
        + (data.messages ? ` · ${data.messages} email(s) d'historique` : ''));
      setPicked(new Set());
      if (selected && ids.includes(selected)) setSelected(null);
      load();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '18px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <input style={{ ...inp, width: 280 }} placeholder="Rechercher (email, nom, contact calling, enseigne…)"
            value={query} onChange={e => setQuery(e.target.value)} />
          <div style={{ fontSize: 12, color: '#9aa1b4' }}>{total} lead{total > 1 ? 's' : ''}</div>
          <button style={{ ...btnDef, marginLeft: 'auto' }} onClick={() => setFromCrm(true)}>Importer depuis le CRM</button>
          <button style={btnDef} onClick={() => setCreating(true)}>+ Nouveau lead</button>
          <button style={btnPri} onClick={() => setImporting(true)}>+ Importer un CSV</button>
        </div>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 14 }}>
          <FilterChip label="Tous" count={totalAll} active={!status} color="#3b71f5"
            onClick={() => { setStatus(''); setPage(1); }} />
          {LEAD_STATUSES.map(item => (
            <FilterChip key={item.key} label={item.label} count={counts[item.key] || 0}
              active={status === item.key} color={item.color}
              onClick={() => { setStatus(item.key); setPage(1); }} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: '#6b7283' }}>Enseigne</span>
          <select style={{ ...inp, width: 220, height: 30, padding: '0 8px', fontSize: 12 }}
            value={company}
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
          {company && (
            <button style={btnXs} onClick={() => { setCompany(''); setPage(1); }}>Effacer</button>
          )}
          <span style={{ fontSize: 11.5, color: '#6b7283', marginLeft: 8 }}>Poste</span>
          <select style={{ ...inp, width: 180, height: 30, padding: '0 8px', fontSize: 12 }}
            value={jobTitle}
            title="Ne garder que les leads occupant ce poste"
            onChange={event => { setJobTitle(event.target.value); setPage(1); }}>
            <option value="">Tous les postes</option>
            {/* Le poste choisi reste listé même si la recherche courante ne le
                contient plus : sinon le sélecteur afficherait une valeur
                absente de ses options. */}
            {jobTitle && !jobTitles.some(item => item.name.toLowerCase() === jobTitle.toLowerCase()) && (
              <option value={jobTitle}>{jobTitle}</option>
            )}
            {jobTitles.map(item => (
              <option key={item.name} value={item.name}>{item.name} ({item.count})</option>
            ))}
          </select>
          {jobTitle && (
            <button style={btnXs} onClick={() => { setJobTitle(''); setPage(1); }}>Effacer</button>
          )}
          <span style={{ fontSize: 11.5, color: '#6b7283', marginLeft: 8 }}>Dans le CRM</span>
          <select style={{ ...inp, width: 200, height: 30, padding: '0 8px', fontSize: 12 }}
            value={pipelineId}
            onChange={event => {
              setPipelineId(event.target.value);
              // Changer de pipeline invalide l'étape : elle appartenait à
              // l'ancien, et laisserait la liste vide sans qu'on comprenne.
              setColumnId('');
              setPage(1);
            }}>
            <option value="">Tous les pipelines</option>
            {pipelines.map(pipeline => (
              <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>
            ))}
          </select>
          <select style={{ ...inp, width: 220, height: 30, padding: '0 8px', fontSize: 12, opacity: pipelineId ? 1 : 0.55 }}
            value={columnId} disabled={!pipelineId}
            title={pipelineId ? undefined : "Choisissez d'abord un pipeline"}
            onChange={event => { setColumnId(event.target.value); setPage(1); }}>
            <option value="">Toutes les étapes</option>
            {columns.map(column => (
              <option key={column.id} value={column.id}>{column.title}</option>
            ))}
          </select>
          {(pipelineId || columnId) && (
            <button style={btnXs} onClick={() => { setPipelineId(''); setColumnId(''); setPage(1); }}>
              Effacer le filtre CRM
            </button>
          )}
        </div>

        {picked.size > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
            background: T.primarySoft, border: '1px solid rgba(59,113,245,.38)',
            borderRadius: 9, padding: '9px 14px',
          }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: T.primaryText }}>
              {picked.size} lead{picked.size > 1 ? 's' : ''} sélectionné{picked.size > 1 ? 's' : ''}
            </span>
            <button style={btnXs} onClick={() => setPicked(new Set())}>Tout décocher</button>
            <button style={{ ...btnPri, marginLeft: 'auto', padding: '6px 12px', fontSize: 12.5 }} onClick={() => setEnrolling(true)}>
              📣 Envoyer dans une campagne
            </button>
            <button style={{ ...btnDanger, opacity: deleting ? 0.6 : 1 }}
              disabled={deleting} onClick={removePicked}>
              {deleting ? 'Suppression…' : `Supprimer ${picked.size} lead${picked.size > 1 ? 's' : ''}`}
            </button>
          </div>
        )}

        {error && <ReadErrorBanner message={error} schemaLag={schemaLag} onRetry={load} />}

        {loading ? (
          <div style={{ fontSize: 13, color: '#6b7283' }}>Chargement…</div>
        ) : error ? null : leads.length === 0 ? (
          <div style={{ background: '#171a23', border: '1px dashed #333a4a', borderRadius: 12, padding: 28, textAlign: 'center', color: '#9aa1b4', fontSize: 13 }}>
            {search || status || company || jobTitle || pipelineId || columnId
              ? 'Aucun lead ne correspond à ce filtre.'
              : 'Aucun lead pour l\'instant — importez un fichier pour commencer.'}
          </div>
        ) : (
          <div style={{ background: '#171a23', border: '1px solid #262b38', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#1c1f2a', textAlign: 'left', color: '#9aa1b4' }}>
                  <th style={{ ...th, width: 34, paddingRight: 0 }}>
                    <input type="checkbox" title="Tout cocher sur cette page"
                      checked={leads.length > 0 && leads.every(lead => picked.has(lead.id))}
                      onChange={togglePage} />
                  </th>
                  <th style={th}>Contact</th>
                  <th style={th}>Contact calling</th>
                  <th style={th}>Enseigne</th>
                  <th style={th}>Poste</th>
                  <th style={th}>Ville</th>
                  <th style={th}>Étape CRM</th>
                  <th style={th}>Statut</th>
                  <th style={th}>Dernier contact</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <tr key={lead.id} onClick={() => setSelected(lead.id)}
                    style={{ borderTop: '1px solid #222634', cursor: 'pointer', background: selected === lead.id ? 'rgba(59,113,245,.16)' : undefined }}>
                    {/* La case ne doit pas ouvrir la fiche : on arrête le clic ici. */}
                    <td style={{ ...td, paddingRight: 0 }} onClick={event => event.stopPropagation()}>
                      <input type="checkbox" checked={picked.has(lead.id)} onChange={() => toggle(lead.id)} />
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>
                        {[lead.civility, lead.firstName, lead.lastName].filter(Boolean).join(' ') || '—'}
                      </div>
                      <div style={{ color: '#6b7283', fontSize: 11.5 }}>{lead.email}</div>
                    </td>
                    <td style={td}>{lead.contactCalling || '—'}</td>
                    <td style={td}>{lead.company || '—'}</td>
                    <td style={td}>{lead.jobTitle || '—'}</td>
                    <td style={td}>{lead.city || '—'}</td>
                    <td style={td}>
                      {lead.crm ? (
                        <span
                          title={lead.crm.kind === 'linked'
                            ? `${lead.crm.pipeline} — le lead vient de cette affaire`
                            : `${lead.crm.pipeline} — rapproché par enseigne + ville `
                              + `(${[lead.crm.store || lead.crm.brand, lead.crm.city].filter(Boolean).join(', ')})`
                              + (lead.crm.others > 0 ? ` · ${lead.crm.others} autre(s) affaire(s)` : '')}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                            color: lead.crm.color, background: `${lead.crm.color}18`,
                            border: lead.crm.kind === 'matched' ? `1px dashed ${lead.crm.color}66` : '1px solid transparent',
                          }}>
                          {lead.crm.column}
                          {/* Le trait pointillé et le « ~ » disent la même chose :
                              rapprochement probable, pas rattachement. */}
                          {lead.crm.kind === 'matched' && <span style={{ fontWeight: 700, opacity: .75 }}>~</span>}
                        </span>
                      ) : <span style={{ color: '#6b7283' }}>—</span>}
                    </td>
                    <td style={td}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                        color: statusColor(lead.status), background: `${statusColor(lead.status)}18`,
                      }}>{statusLabel(lead.status)}</span>
                    </td>
                    <td style={{ ...td, color: '#6b7283' }}>
                      {lead.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleDateString('fr-FR') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <button style={btnDef} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Précédent</button>
            <span style={{ fontSize: 12, color: '#9aa1b4' }}>Page {page} / {pages}</span>
            <button style={btnDef} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Suivant</button>
          </div>
        )}
      </div>

      {selected && (
        <LeadDrawer
          leadId={selected}
          userName={user?.name}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}

      {importing && (
        <LeadImportModal userName={user?.name} onClose={() => setImporting(false)} onDone={load} />
      )}

      {creating && (
        <LeadFormModal userName={user?.name} onClose={() => setCreating(false)} onSaved={load} />
      )}

      {fromCrm && (
        <DealImportModal userName={user?.name} onClose={() => setFromCrm(false)} onDone={load} />
      )}

      {enrolling && (
        <EnrollInCampaignModal
          leadIds={Array.from(picked)}
          filter={{
            q: search || undefined,
            status: status || undefined,
            company: company || undefined,
            jobTitle: jobTitle || undefined,
            pipelineId: pipelineId || undefined,
            columnIds: pipelineId && columnId ? [columnId] : undefined,
          }}
          filterTotal={total}
          onClose={() => setEnrolling(false)}
          onDone={() => { setPicked(new Set()); load(); }}
        />
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: '9px 12px', fontWeight: 600, fontSize: 11.5 };
const td: React.CSSProperties = { padding: '9px 12px' };

function FilterChip({ label, count, active, color, onClick }: {
  label: string; count: number; active: boolean; color: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 12,
      fontWeight: active ? 700 : 500,
      border: `1px solid ${active ? color : '#262b38'}`,
      background: active ? `${color}18` : '#171a23',
      color: active ? color : '#9aa1b4',
    }}>
      {label} <span style={{ opacity: 0.7 }}>{count}</span>
    </button>
  );
}
