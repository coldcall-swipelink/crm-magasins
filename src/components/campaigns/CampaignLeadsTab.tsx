'use client';
// src/components/campaigns/CampaignLeadsTab.tsx
//
// Les leads d'une campagne, et leur pilotage UN PAR UN : mettre en pause,
// reprendre, arrêter ou retirer la séquence d'un seul lead sans toucher aux
// autres ni à la campagne. « Retirer » enlève le lead de CETTE campagne
// seulement : il reste dans la liste générale des leads. Plusieurs leads
// cochés se retirent d'un coup.
//
// Un clic sur une ligne ouvre l'historique du lead dans la campagne : chaque
// email parti et son état (envoyé, ouvert, répondu).
//
// Trois façons d'ajouter des leads, parce que les trois usages existent :
//   • depuis les leads déjà en base, en cochant (ou d'un bloc par recherche) ;
//   • à la main, pour le contact qu'on vient d'avoir au téléphone ;
//   • par fichier CSV, importé ET inscrit dans la foulée.

import { useCallback, useEffect, useState } from 'react';
import { useCurrentUser } from '@/lib/currentUser';
import { toast } from '@/components/ui/Toast';
import DealImportModal from './DealImportModal';
import EnrollmentDrawer, { type EnrollmentAction } from './EnrollmentDrawer';
import LeadFormModal from './LeadFormModal';
import LeadImportModal from './LeadImportModal';
import LeadPickerModal from './LeadPickerModal';
import { ENROLLMENT_STATUS, STOP_REASONS, btnDef, btnPri, btnXs } from './ui';

type Enrollment = {
  id: string;
  status: string;
  stopReason: string | null;
  sentSteps: number;
  nextSendAt: string | null;
  lead: { id: string; email: string; civility: string | null; firstName: string | null; lastName: string | null; company: string | null; status: string };
  mailbox: { email: string } | null;
  messages: Array<{ sentAt: string; openedAt: string | null; repliedAt: string | null; stepPosition: number }>;
};

export default function CampaignLeadsTab({ campaignId, onChanged }: {
  campaignId: string;
  onChanged: () => void;
}) {
  const { user } = useCurrentUser();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  // Quelle fenêtre d'ajout est ouverte : aucune, le choix parmi les leads
  // existants, la saisie manuelle, ou l'import de fichier.
  const [adding, setAdding] = useState<'pick' | 'manual' | 'import' | 'crm' | null>(null);
  // Sélection multiple : les inscriptions cochées, toutes pages confondues.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  // Le lead dont l'historique est ouvert dans le volet de droite.
  const [opened, setOpened] = useState<string | null>(null);
  // Incrémenté à chaque rechargement : le volet se remet à jour avec.
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set('status', status);
      const res = await fetch(`/api/campaigns/${campaignId}/enrollments?${params}`);
      const data = await res.json();
      setEnrollments(data.enrollments || []);
      setCounts(data.statusCounts || {});
      setTotal(data.total || 0);
      setPages(data.pages || 1);
      setVersion(v => v + 1);
    } finally {
      setLoading(false);
    }
  }, [campaignId, page, status]);

  useEffect(() => { load(); }, [load]);

  const act = async (enrollmentId: string, action: EnrollmentAction) => {
    const res = await fetch(`/api/campaigns/${campaignId}/enrollments/${enrollmentId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, userName: user?.name }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Action impossible', 'error'); return; }
    load();
    onChanged();
  };

  /** Retire le lead de la campagne (son inscription seulement, pas le lead). */
  const remove = async (enrollmentId: string) => {
    const enrollment = enrollments.find(item => item.id === enrollmentId);
    const who = enrollment
      ? [enrollment.lead.firstName, enrollment.lead.lastName].filter(Boolean).join(' ') || enrollment.lead.email
      : 'ce lead';
    const sent = enrollment && enrollment.sentSteps > 0
      ? `Les ${enrollment.sentSteps} email${enrollment.sentSteps > 1 ? 's' : ''} déjà envoyé${enrollment.sentSteps > 1 ? 's' : ''} disparaîtront des statistiques de la campagne. `
      : '';
    if (!confirm(`Retirer ${who} de cette campagne ?\n\n${sent}Le lead reste dans votre liste de leads.`)) return;
    const params = new URLSearchParams();
    if (user?.name) params.set('userName', user.name);
    const res = await fetch(`/api/campaigns/${campaignId}/enrollments/${enrollmentId}?${params}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || 'Retrait impossible', 'error'); return; }
    toast('Lead retiré de la campagne');
    if (opened === enrollmentId) setOpened(null);
    setPicked(current => { const next = new Set(current); next.delete(enrollmentId); return next; });
    load();
    onChanged();
  };

  const toggle = (id: string) => setPicked(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /** Coche ou décoche toute la page affichée. */
  const togglePage = () => {
    const ids = enrollments.map(enrollment => enrollment.id);
    const allPicked = ids.every(id => picked.has(id));
    setPicked(current => {
      const next = new Set(current);
      for (const id of ids) { if (allPicked) next.delete(id); else next.add(id); }
      return next;
    });
  };

  /** Retire d'un coup tous les leads cochés (leurs inscriptions seulement). */
  const removePicked = async () => {
    const ids = Array.from(picked);
    if (ids.length === 0) return;
    // Ce que la sélection a déjà reçu, pour l'annoncer avant : on ne connaît
    // que la page affichée, le serveur dira le compte exact après.
    const sentOnPage = enrollments.filter(item => picked.has(item.id)).reduce((sum, item) => sum + item.sentSteps, 0);
    if (!confirm(
      `Retirer ${ids.length} lead${ids.length > 1 ? 's' : ''} de cette campagne ?\n\n`
      + (sentOnPage > 0 ? 'Les emails déjà envoyés disparaîtront des statistiques de la campagne. ' : '')
      + 'Les leads restent dans votre liste de leads.',
    )) return;

    setRemoving(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/enrollments`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentIds: ids, userName: user?.name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'Retrait impossible', 'error'); return; }
      toast(`${data.removed} lead${data.removed > 1 ? 's' : ''} retiré${data.removed > 1 ? 's' : ''} de la campagne`
        + (data.messages ? ` · ${data.messages} email${data.messages > 1 ? 's' : ''} d'historique` : ''));
      setPicked(new Set());
      if (opened && ids.includes(opened)) setOpened(null);
      load();
      onChanged();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div style={{ padding: '18px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <Chip label="Tous" count={Object.values(counts).reduce((sum, n) => sum + n, 0)}
          active={!status} color="#3b71f5" onClick={() => { setStatus(''); setPage(1); }} />
        {Object.entries(ENROLLMENT_STATUS).map(([key, item]) => (
          <Chip key={key} label={item.label} count={counts[key] || 0} active={status === key}
            color={item.color} onClick={() => { setStatus(key); setPage(1); }} />
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button style={btnPri} onClick={() => setAdding('pick')}>+ Depuis mes leads</button>
          <button style={btnDef} onClick={() => setAdding('manual')}>+ Nouveau lead</button>
          <button style={btnDef} onClick={() => setAdding('import')}>+ Importer un CSV</button>
          <button style={btnDef} onClick={() => setAdding('crm')}>+ Depuis le CRM</button>
        </div>
      </div>

      {picked.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '8px 12px', background: 'rgba(59,113,245,.10)', border: '1px solid rgba(59,113,245,.35)', borderRadius: 10 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>
            {picked.size} lead{picked.size > 1 ? 's' : ''} sélectionné{picked.size > 1 ? 's' : ''}
          </span>
          <button style={btnXs} onClick={() => setPicked(new Set())}>Tout décocher</button>
          <button style={{ ...btnXs, marginLeft: 'auto', borderColor: 'rgba(239,68,68,.35)', background: 'rgba(239,68,68,.13)', color: '#f87171' }}
            disabled={removing} onClick={removePicked}>
            {removing ? 'Retrait…' : 'Retirer de la campagne'}
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: '#6b7283' }}>Chargement…</div>
      ) : enrollments.length === 0 ? (
        <div style={{ background: '#171a23', border: '1px dashed #333a4a', borderRadius: 12, padding: 28, textAlign: 'center', color: '#9aa1b4', fontSize: 13 }}>
          {status ? 'Aucun lead dans cet état.' : 'Aucun lead inscrit. Ajoutez-en pour que la campagne ait de quoi travailler.'}
        </div>
      ) : (
        <div style={{ background: '#171a23', border: '1px solid #262b38', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#1c1f2a', textAlign: 'left', color: '#9aa1b4' }}>
                <th style={{ ...th, width: 34, paddingRight: 0 }}>
                  <input type="checkbox" title="Tout cocher sur cette page"
                    checked={enrollments.length > 0 && enrollments.every(enrollment => picked.has(enrollment.id))}
                    onChange={togglePage} />
                </th>
                <th style={th}>Lead</th>
                <th style={th}>Avancement</th>
                <th style={th}>Boîte</th>
                <th style={th}>Prochain envoi</th>
                <th style={th}>État</th>
                <th style={{ ...th, width: 240 }}></th>
              </tr>
            </thead>
            <tbody>
              {enrollments.map(enrollment => {
                const state = ENROLLMENT_STATUS[enrollment.status] || { label: enrollment.status, color: '#9aa1b4' };
                const last = enrollment.messages[0];
                return (
                  <tr key={enrollment.id} onClick={() => setOpened(enrollment.id)} title="Voir l'historique de ce lead dans la campagne"
                    style={{ borderTop: '1px solid #222634', cursor: 'pointer', background: opened === enrollment.id ? 'rgba(59,113,245,.16)' : picked.has(enrollment.id) ? 'rgba(59,113,245,.07)' : undefined }}>
                    {/* La case ne doit pas ouvrir l'historique : on arrête le clic ici. */}
                    <td style={{ ...td, paddingRight: 0 }} onClick={event => event.stopPropagation()}>
                      <input type="checkbox" checked={picked.has(enrollment.id)} onChange={() => toggle(enrollment.id)} />
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>
                        {[enrollment.lead.firstName, enrollment.lead.lastName].filter(Boolean).join(' ') || enrollment.lead.email}
                      </div>
                      <div style={{ color: '#6b7283', fontSize: 11.5 }}>
                        {enrollment.lead.email}{enrollment.lead.company ? ` · ${enrollment.lead.company}` : ''}
                      </div>
                    </td>
                    <td style={td}>
                      {enrollment.sentSteps === 0 ? <span style={{ color: '#6b7283' }}>rien envoyé</span> : (
                        <span>
                          {enrollment.sentSteps} email{enrollment.sentSteps > 1 ? 's' : ''}
                          {last?.openedAt && <span title="Ouvert"> · 👁️</span>}
                          {last?.repliedAt && <span title="A répondu"> · 💬</span>}
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, color: '#9aa1b4', fontSize: 11.5 }}>{enrollment.mailbox?.email || '—'}</td>
                    <td style={{ ...td, color: '#9aa1b4' }}>
                      {enrollment.nextSendAt
                        ? new Date(enrollment.nextSendAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </td>
                    <td style={td}>
                      <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: state.color, background: `${state.color}18` }}>
                        {state.label}
                      </span>
                      {enrollment.stopReason && (
                        <div style={{ fontSize: 10.5, color: '#6b7283', marginTop: 2 }}>
                          {STOP_REASONS[enrollment.stopReason] || enrollment.stopReason}
                        </div>
                      )}
                    </td>
                    {/* Les boutons non plus. */}
                    <td style={{ ...td, textAlign: 'right' }} onClick={event => event.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
                        {enrollment.status === 'active' && (
                          <button style={btnXs} onClick={() => act(enrollment.id, 'pause')}>Pause</button>
                        )}
                        {(enrollment.status === 'paused' || enrollment.status === 'stopped') && (
                          <button style={btnXs} onClick={() => act(enrollment.id, 'resume')}>Reprendre</button>
                        )}
                        {enrollment.status !== 'stopped' && enrollment.status !== 'finished' && (
                          <button style={{ ...btnXs, borderColor: 'rgba(239,68,68,.35)', background: 'rgba(239,68,68,.13)', color: '#f87171' }}
                            onClick={() => act(enrollment.id, 'stop')}>Arrêter</button>
                        )}
                        <button style={{ ...btnXs, color: '#f87171' }} title="Retirer ce lead de la campagne (il reste dans la liste des leads)"
                          onClick={() => remove(enrollment.id)}>Retirer</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <div style={{ fontSize: 12, color: '#9aa1b4' }}>{total} lead{total > 1 ? 's' : ''} dans la campagne</div>
        {pages > 1 && (
          <>
            <button style={{ ...btnDef, marginLeft: 'auto' }} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Précédent</button>
            <span style={{ fontSize: 12, color: '#9aa1b4' }}>Page {page} / {pages}</span>
            <button style={btnDef} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Suivant</button>
          </>
        )}
      </div>

      {opened && (
        <EnrollmentDrawer campaignId={campaignId} enrollmentId={opened} refreshKey={version}
          onClose={() => setOpened(null)} onAction={act} onRemove={remove} />
      )}

      {adding === 'pick' && (
        <LeadPickerModal campaignId={campaignId} onClose={() => setAdding(null)}
          onDone={() => { load(); onChanged(); }} />
      )}
      {adding === 'manual' && (
        <LeadFormModal campaignId={campaignId} userName={user?.name} onClose={() => setAdding(null)}
          onSaved={() => { load(); onChanged(); }} />
      )}
      {adding === 'import' && (
        <LeadImportModal campaignId={campaignId} userName={user?.name} onClose={() => setAdding(null)}
          onDone={() => { load(); onChanged(); }} />
      )}
      {adding === 'crm' && (
        <DealImportModal campaignId={campaignId} userName={user?.name} onClose={() => setAdding(null)}
          onDone={() => { load(); onChanged(); }} />
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: '9px 12px', fontWeight: 600, fontSize: 11.5 };
const td: React.CSSProperties = { padding: '9px 12px' };

function Chip({ label: text, count, active, color, onClick }: {
  label: string; count: number; active: boolean; color: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 12,
      fontWeight: active ? 700 : 500,
      border: `1px solid ${active ? color : '#262b38'}`,
      background: active ? `${color}18` : '#171a23',
      color: active ? color : '#9aa1b4',
    }}>{text} <span style={{ opacity: 0.7 }}>{count}</span></button>
  );
}
