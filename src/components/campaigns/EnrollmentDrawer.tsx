'use client';
// src/components/campaigns/EnrollmentDrawer.tsx
//
// L'historique d'UN lead dans UNE campagne, ouvert d'un clic sur sa ligne.
//
// La question posée est toujours la même : « où en est-on avec lui ? ». On
// y répond étape par étape : pour chaque email de la séquence, s'il est
// parti, s'il a été ouvert, s'il a reçu une réponse, ou quand il partira.
// Les réponses reçues et les événements (inscription, arrêt, désinscription)
// suivent, puis les mêmes commandes que dans le tableau.

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { MessageDetail, VariantTag, type MessageDetailData } from './MessagesHistory';
import { ENROLLMENT_STATUS, STOP_REASONS, T, btnDef, btnXs, formatDelay, pill } from './ui';

type Message = {
  id: string; stepId: string | null; stepPosition: number; variantKey?: string; status: string; subject: string;
  toAddress: string; fromAddress: string; sentAt: string;
  openedAt: string | null; openCount: number; repliedAt: string | null; error: string | null;
};

type Step = { id: string; position: number; subject: string; delayHours: number };

type Data = {
  enrollment: {
    id: string; status: string; stopReason: string | null; sentSteps: number;
    nextSendAt: string | null; startedAt: string | null; finishedAt: string | null; createdAt: string;
    lead: { id: string; email: string; civility: string | null; firstName: string | null; lastName: string | null; company: string | null; status: string };
    mailbox: { email: string } | null;
    campaign: { id: string; name: string; status: string; steps: Step[] };
    messages: Message[];
  };
  replies: Array<{ id: string; subject: string; snippet: string; receivedAt: string; fromAddress: string }>;
  events: Array<{ id: string; type: string; label: string; userName: string | null; createdAt: string }>;
};

export type EnrollmentAction = 'pause' | 'resume' | 'stop';

const EVENT_ICONS: Record<string, string> = {
  enrolled: '🎯', stopped: '⏹️', replied: '💬', unsubscribed: '🚫', bounced: '⚠️',
};

/** L'état d'un email envoyé, du plus fort au plus faible. */
function messageState(message: Message): { label: string; color: string } {
  if (message.status === 'failed') return { label: 'Échec', color: T.dangerText };
  if (message.repliedAt) return { label: 'Répondu', color: T.violetText };
  if (message.openedAt) return { label: 'Ouvert', color: '#4ade80' };
  return { label: 'Envoyé', color: T.primaryText };
}

export default function EnrollmentDrawer({ campaignId, enrollmentId, onClose, onAction, onRemove, refreshKey }: {
  campaignId: string;
  enrollmentId: string;
  onClose: () => void;
  /** Pause, reprise, arrêt : exécutés par le tableau, qui recharge ensuite. */
  onAction: (enrollmentId: string, action: EnrollmentAction) => Promise<void>;
  /** Retrait de la campagne : le tableau confirme, retire, puis ferme le volet. */
  onRemove: (enrollmentId: string) => Promise<void>;
  /** Change quand le tableau a rechargé : le volet se remet alors à jour. */
  refreshKey: number;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MessageDetailData | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/enrollments/${enrollmentId}`);
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) { setError(json?.error || 'Historique indisponible'); return; }
    setData(json);
  }, [campaignId, enrollmentId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Échap ferme le volet, comme une fenêtre.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !detail) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, detail]);

  const openMessage = async (id: string) => {
    const json = await fetch(`/api/campaigns/messages/${id}`).then(res => res.json()).catch(() => null);
    if (!json || json.error) { toast('Email introuvable', 'error'); return; }
    setDetail(json);
  };

  const enrollment = data?.enrollment;
  const state = enrollment ? (ENROLLMENT_STATUS[enrollment.status] || { label: enrollment.status, color: T.textMuted }) : null;
  const who = enrollment
    ? [enrollment.lead.firstName, enrollment.lead.lastName].filter(Boolean).join(' ') || enrollment.lead.email
    : '';

  // Le fil, étape par étape. Un email parti se rattache à son étape par son
  // identifiant, ou à défaut par son rang (étape supprimée depuis).
  const byStep = new Map<number, Message[]>();
  for (const message of enrollment?.messages || []) {
    const position = enrollment!.campaign.steps.find(step => step.id === message.stepId)?.position ?? message.stepPosition;
    byStep.set(position, [...(byStep.get(position) || []), message]);
  }
  const positions = Array.from(new Set([
    ...(enrollment?.campaign.steps.map(step => step.position) || []),
    ...Array.from(byStep.keys()),
  ])).sort((a, b) => a - b);
  // La prochaine étape attendue : la première sans email envoyé.
  const nextPosition = positions.find(position => !(byStep.get(position) || []).some(message => message.status === 'sent'));

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(5, 7, 12, .45)', zIndex: 60 }} />
      <aside onClick={event => event.stopPropagation()} style={panelStyle}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textFaint, letterSpacing: '.6px', marginBottom: 4 }}>
              HISTORIQUE DANS LA CAMPAGNE
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who || '…'}</div>
            {enrollment && (
              <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {enrollment.lead.email}{enrollment.lead.company ? ` · ${enrollment.lead.company}` : ''}
              </div>
            )}
          </div>
          <button style={btnXs} onClick={onClose} title="Fermer (Échap)">✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
          {error ? (
            <div style={{ fontSize: 13, color: T.dangerText }}>{error}</div>
          ) : !enrollment || !state ? (
            <div style={{ fontSize: 13, color: T.textFaint }}>Chargement…</div>
          ) : (
            <>
              {/* Où il en est, en une ligne. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={pill(state.color)}>{state.label}</span>
                {enrollment.stopReason && (
                  <span style={{ fontSize: 12, color: T.textMuted }}>{STOP_REASONS[enrollment.stopReason] || enrollment.stopReason}</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.7, marginBottom: 16 }}>
                {enrollment.sentSteps} email{enrollment.sentSteps > 1 ? 's' : ''} envoyé{enrollment.sentSteps > 1 ? 's' : ''} sur {enrollment.campaign.steps.length}
                {enrollment.mailbox ? <> · depuis {enrollment.mailbox.email}</> : null}
                <br />
                Inscrit le {formatDate(enrollment.createdAt)}
                {enrollment.nextSendAt && enrollment.status === 'active' && <> · prochain envoi le {formatDate(enrollment.nextSendAt)}</>}
                {enrollment.finishedAt && enrollment.status !== 'active' && <> · terminé le {formatDate(enrollment.finishedAt)}</>}
              </div>

              <div style={sectionTitle}>EMAILS DE LA SÉQUENCE</div>
              {positions.length === 0 ? (
                <div style={{ fontSize: 12.5, color: T.textFaint, marginBottom: 14 }}>La séquence n&apos;a encore aucune étape.</div>
              ) : positions.map(position => {
                const step = enrollment.campaign.steps.find(item => item.position === position);
                const messages = byStep.get(position) || [];
                const sent = messages.filter(message => message.status === 'sent');
                const failed = messages.filter(message => message.status === 'failed');
                const isNext = position === nextPosition;
                const pending = sent.length === 0;
                return (
                  <div key={position} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                    {/* Le rang, dans une pastille : plein si parti, creux sinon. */}
                    <div style={{
                      width: 24, height: 24, borderRadius: 999, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700,
                      background: pending ? 'transparent' : T.primarySoft,
                      border: `1px solid ${pending ? T.border : `${T.primary}66`}`,
                      color: pending ? T.textFaint : T.primaryText,
                    }}>{position}</div>
                    <div style={{ flex: 1, minWidth: 0, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 10px', opacity: pending && !isNext ? 0.7 : 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sent[0]?.subject || step?.subject || `Étape ${position}`}
                      </div>

                      {sent.map(message => {
                        const messageStatus = messageState(message);
                        return (
                          <div key={message.id} style={{ marginTop: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                              <span style={pill(messageStatus.color)}>{messageStatus.label}</span>
                              {message.variantKey && <VariantTag letter={message.variantKey} />}
                              <button style={{ ...btnXs, padding: '2px 8px', marginLeft: 'auto' }} onClick={() => openMessage(message.id)}>Voir l&apos;email</button>
                            </div>
                            <div style={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.7, marginTop: 4 }}>
                              <Row icon="📤" text={`Envoyé le ${formatDate(message.sentAt)}`} />
                              {message.openedAt
                                ? <Row icon="👁️" text={`Ouvert le ${formatDate(message.openedAt)}${message.openCount > 1 ? ` (${message.openCount} fois)` : ''}`} color="#4ade80" />
                                : <Row icon="👁️" text="Pas encore ouvert" faint />}
                              {message.repliedAt
                                ? <Row icon="💬" text={`Réponse reçue le ${formatDate(message.repliedAt)}`} color={T.violetText} />
                                : <Row icon="💬" text="Pas de réponse" faint />}
                            </div>
                          </div>
                        );
                      })}

                      {failed.map(message => (
                        <div key={message.id} style={{ fontSize: 11.5, color: T.dangerText, marginTop: 6 }}>
                          ⚠️ Échec le {formatDate(message.sentAt)}{message.error ? ` : ${message.error.slice(0, 160)}` : ''}
                        </div>
                      ))}

                      {pending && (
                        <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 4 }}>
                          {isNext && enrollment.status === 'active' && enrollment.nextSendAt
                            ? `À venir · prévu le ${formatDate(enrollment.nextSendAt)}`
                            : isNext && enrollment.status === 'paused'
                              ? 'À venir · en pause'
                              : enrollment.status === 'stopped' || enrollment.status === 'finished'
                                ? 'Non envoyé'
                                : step && step.delayHours > 0
                                  ? `À venir · ${formatDelay(step.delayHours)} après l'étape précédente`
                                  : 'À venir'}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {data.replies.length > 0 && (
                <>
                  <div style={{ ...sectionTitle, marginTop: 16 }}>RÉPONSES REÇUES</div>
                  {data.replies.map(reply => (
                    <div key={reply.id} style={{ background: T.violetSoft, border: '1px solid rgba(139,92,246,.35)', borderRadius: 8, padding: '7px 10px', marginBottom: 6 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{reply.subject || '(sans objet)'}</div>
                      <div style={{ fontSize: 12, color: '#b3b9c9', marginTop: 3 }}>{reply.snippet.slice(0, 260)}</div>
                      <div style={{ fontSize: 10.5, color: T.violetText, marginTop: 3 }}>{reply.fromAddress} · {formatDate(reply.receivedAt)}</div>
                    </div>
                  ))}
                </>
              )}

              {data.events.length > 0 && (
                <>
                  <div style={{ ...sectionTitle, marginTop: 16 }}>ÉVÉNEMENTS</div>
                  {data.events.map(event => (
                    <div key={event.id} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '5px 0', borderBottom: `1px solid ${T.borderSoft}` }}>
                      <span>{EVENT_ICONS[event.type] || '•'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div>{event.label}</div>
                        <div style={{ fontSize: 10.5, color: T.textFaint }}>
                          {event.userName ? `${event.userName} · ` : ''}{formatDate(event.createdAt)}
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {enrollment && (
          <div style={{ padding: '12px 18px', borderTop: `1px solid ${T.border}`, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {enrollment.status === 'active' && (
              <button style={smallBtn} onClick={() => onAction(enrollment.id, 'pause')}>Pause</button>
            )}
            {(enrollment.status === 'paused' || enrollment.status === 'stopped') && (
              <button style={smallBtn} onClick={() => onAction(enrollment.id, 'resume')}>Reprendre</button>
            )}
            {enrollment.status !== 'stopped' && enrollment.status !== 'finished' && (
              <button style={{ ...smallBtn, borderColor: 'rgba(239,68,68,.35)', background: T.dangerSoft, color: T.dangerText }}
                onClick={() => onAction(enrollment.id, 'stop')}>Arrêter</button>
            )}
            <button style={{ ...smallBtn, color: T.dangerText, marginLeft: 'auto' }}
              title="Retirer ce lead de la campagne (il reste dans la liste des leads)"
              onClick={() => onRemove(enrollment.id)}>Retirer de la campagne</button>
          </div>
        )}
      </aside>

      {detail && <MessageDetail detail={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function Row({ icon, text, color, faint }: { icon: string; text: string; color?: string; faint?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 6, color: faint ? T.textFaint : color || undefined }}>
      <span style={{ opacity: faint ? 0.5 : 1 }}>{icon}</span>
      <span>{text}</span>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(460px, 100vw)', zIndex: 61,
  background: T.surface, borderLeft: `1px solid ${T.border}`, boxShadow: '-16px 0 48px rgba(0,0,0,.5)',
  display: 'flex', flexDirection: 'column', overflow: 'hidden', color: T.text,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, color: T.textFaint, letterSpacing: '.6px', marginBottom: 8,
};

const smallBtn: React.CSSProperties = { ...btnDef, padding: '5px 11px', fontSize: 12 };

function formatDate(value: string): string {
  return new Date(value).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
