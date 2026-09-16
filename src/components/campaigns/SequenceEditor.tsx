'use client';
// src/components/campaigns/SequenceEditor.tsx
//
// Éditeur de la séquence d'une campagne : la suite des emails et le délai
// d'attente qui précède chacun.
//
// Deux modes de rédaction par étape, comme demandé : un corps TEXTE (converti
// en HTML sobre à l'envoi — le plus sûr pour la délivrabilité) ou un corps
// HTML libre pour un email commercial. Les variables {{prenom}}, {{enseigne}}…
// fonctionnent dans les deux, et l'aperçu montre le rendu sur un vrai lead.

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { btnDef, btnPri, btnXs, card, formatDelay, inp, label } from './ui';

export interface Step {
  id: string;
  position: number;
  delayHours: number;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  useHtml: boolean;
  replyToThread: boolean;
}

type Variable = { name: string; description: string };

/** Délais proposés en un clic — les plus courants en prospection. */
const DELAY_PRESETS = [
  { hours: 0, label: 'Immédiat' },
  { hours: 48, label: '2 jours' },
  { hours: 72, label: '3 jours' },
  { hours: 120, label: '5 jours' },
  { hours: 168, label: '7 jours' },
];

export default function SequenceEditor({ campaignId, steps, onChanged }: {
  campaignId: string;
  steps: Step[];
  onChanged: () => void;
}) {
  const [variables, setVariables] = useState<{ standard: Variable[]; custom: string[] }>({ standard: [], custom: [] });
  const [preview, setPreview] = useState<{ stepId: string; subject: string; html: string; missing: string[]; from: string | null; lead: string } | null>(null);

  const addStep = async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/steps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok) { toast('Ajout impossible', 'error'); return; }
    onChanged();
  };

  const showPreview = async (stepId: string) => {
    const res = await fetch(`/api/campaigns/${campaignId}/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Aperçu indisponible', 'error'); return; }
    setVariables(data.variables);
    setPreview({
      stepId,
      subject: data.preview.subject,
      html: data.preview.html,
      missing: data.preview.missing,
      from: data.preview.from,
      lead: data.preview.lead.email,
    });
  };

  return (
    <div style={{ padding: '18px 24px', maxWidth: 860 }}>
      {steps.map((step, index) => (
        <StepCard
          key={step.id}
          campaignId={campaignId}
          step={step}
          isFirst={index === 0}
          canDelete={steps.length > 1}
          variables={variables}
          onChanged={onChanged}
          onPreview={() => showPreview(step.id)}
        />
      ))}

      <button style={{ ...btnDef, marginTop: 4 }} onClick={addStep}>+ Ajouter une relance</button>

      {preview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 24 }}
          onClick={() => setPreview(null)}>
          <div onClick={event => event.stopPropagation()} style={{ ...card, width: 'min(720px, 100%)', maxHeight: '88vh', overflow: 'auto' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Aperçu sur un lead réel</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>De : {preview.from || '— aucune boîte affectée —'}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>À : {preview.lead}</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, padding: '8px 0', borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', marginBottom: 12 }}>
              {preview.subject || <span style={{ color: '#dc2626' }}>(sujet vide)</span>}
            </div>
            {preview.missing.length > 0 && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#78350f', marginBottom: 12 }}>
                Variables sans valeur pour ce lead : {preview.missing.map(name => `{{${name}}}`).join(', ')}.
                Donnez-leur une valeur de repli — <code>{'{{prenom|bonjour}}'}</code> — pour éviter les phrases bancales.
              </div>
            )}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, background: '#fff' }}
              dangerouslySetInnerHTML={{ __html: preview.html }} />
            <button style={{ ...btnDef, marginTop: 14 }} onClick={() => setPreview(null)}>Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepCard({ campaignId, step, isFirst, canDelete, variables, onChanged, onPreview }: {
  campaignId: string;
  step: Step;
  isFirst: boolean;
  canDelete: boolean;
  variables: { standard: Variable[]; custom: string[] };
  onChanged: () => void;
  onPreview: () => void;
}) {
  const [draft, setDraft] = useState(step);
  const [saved, setSaved] = useState(true);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  // Dernier champ touché : la variable cliquée s'insère là où on écrivait.
  const lastFocus = useRef<'subject' | 'body'>('body');

  useEffect(() => { setDraft(step); setSaved(true); }, [step]);

  const save = useCallback(async (patch: Partial<Step>) => {
    const res = await fetch(`/api/campaigns/${campaignId}/steps/${step.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) { toast('Enregistrement refusé', 'error'); return; }
    setSaved(true);
    onChanged();
  }, [campaignId, step.id, onChanged]);

  const remove = async () => {
    if (!confirm(`Supprimer l'étape ${step.position} ?`)) return;
    const res = await fetch(`/api/campaigns/${campaignId}/steps/${step.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Suppression impossible', 'error'); return; }
    onChanged();
  };

  /** Insère {{variable}} à l'endroit du curseur, dans le champ actif. */
  const insertVariable = (name: string) => {
    const token = `{{${name}}}`;
    if (lastFocus.current === 'subject' && subjectRef.current) {
      const field = subjectRef.current;
      const start = field.selectionStart ?? field.value.length;
      const next = field.value.slice(0, start) + token + field.value.slice(field.selectionEnd ?? start);
      setDraft({ ...draft, subject: next });
    } else if (bodyRef.current) {
      const field = bodyRef.current;
      const start = field.selectionStart ?? field.value.length;
      const next = field.value.slice(0, start) + token + field.value.slice(field.selectionEnd ?? start);
      setDraft(draft.useHtml ? { ...draft, bodyHtml: next } : { ...draft, bodyText: next });
    }
    setSaved(false);
  };

  const change = (patch: Partial<Step>) => { setDraft({ ...draft, ...patch }); setSaved(false); };

  return (
    <div style={{ ...card, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#eef2ff', color: '#4338ca', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {step.position}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>
          {isFirst ? 'Premier email' : `Relance ${step.position - 1}`}
        </div>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          {isFirst ? '— part dès l\'inscription du lead' : `— ${formatDelay(draft.delayHours)} après l'email précédent`}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button style={btnXs} onClick={onPreview}>Aperçu</button>
          {canDelete && <button style={{ ...btnXs, borderColor: '#fecaca', background: '#fef2f2', color: '#b91c1c' }} onClick={remove}>Supprimer</button>}
        </div>
      </div>

      {!isFirst && (
        <div style={{ marginBottom: 12 }}>
          <label style={label}>Attendre avant cet email</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {DELAY_PRESETS.filter(preset => preset.hours > 0).map(preset => (
              <button key={preset.hours} onClick={() => change({ delayHours: preset.hours })} style={{
                ...btnXs,
                borderColor: draft.delayHours === preset.hours ? '#4f46e5' : '#e2e8f0',
                background: draft.delayHours === preset.hours ? '#eef2ff' : '#f8fafc',
                color: draft.delayHours === preset.hours ? '#4338ca' : '#64748b',
              }}>{preset.label}</button>
            ))}
            <input style={{ ...inp, width: 90 }} type="number" min={0} value={draft.delayHours}
              onChange={event => change({ delayHours: Number(event.target.value) })} />
            <span style={{ fontSize: 12, color: '#94a3b8' }}>heures</span>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <label style={label}>Sujet</label>
        <input ref={subjectRef} style={inp} value={draft.subject}
          onFocus={() => { lastFocus.current = 'subject'; }}
          placeholder="Une question sur {{enseigne}}"
          onChange={event => change({ subject: event.target.value })} />
        {!isFirst && draft.replyToThread && (
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
            Cette relance part dans le fil du premier email : c&apos;est son sujet, préfixé « Re: », qui sera utilisé.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
        <label style={{ ...label, marginBottom: 0 }}>Corps du message</label>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <button onClick={() => change({ useHtml: false })} style={{
            ...btnXs,
            borderColor: !draft.useHtml ? '#4f46e5' : '#e2e8f0',
            background: !draft.useHtml ? '#eef2ff' : '#f8fafc',
            color: !draft.useHtml ? '#4338ca' : '#64748b',
          }}>Texte</button>
          <button onClick={() => change({ useHtml: true })} style={{
            ...btnXs,
            borderColor: draft.useHtml ? '#4f46e5' : '#e2e8f0',
            background: draft.useHtml ? '#eef2ff' : '#f8fafc',
            color: draft.useHtml ? '#4338ca' : '#64748b',
          }}>HTML</button>
        </div>
      </div>
      <textarea
        ref={bodyRef}
        style={{ ...inp, minHeight: draft.useHtml ? 220 : 180, resize: 'vertical',
          fontFamily: draft.useHtml ? 'ui-monospace, monospace' : undefined,
          fontSize: draft.useHtml ? 12 : 13, lineHeight: 1.5 }}
        value={draft.useHtml ? draft.bodyHtml : draft.bodyText}
        onFocus={() => { lastFocus.current = 'body'; }}
        placeholder={draft.useHtml
          ? '<p>Bonjour {{prenom|bonjour}},</p>'
          : 'Bonjour {{prenom|bonjour}},\n\nJe vous écris parce que…'}
        onChange={event => change(draft.useHtml ? { bodyHtml: event.target.value } : { bodyText: event.target.value })}
      />
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 5 }}>
        {draft.useHtml
          ? 'HTML libre : idéal pour un email commercial. Un email trop maquetté passe moins bien les filtres qu\'un email simple.'
          : 'Texte simple, converti en HTML sobre à l\'envoi — c\'est le format qui arrive le mieux en boîte de réception.'}
      </div>

      {(variables.standard.length > 0 || variables.custom.length > 0) && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...label, marginBottom: 5 }}>Variables (cliquez pour insérer)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {variables.standard.map(variable => (
              <button key={variable.name} title={variable.description} onClick={() => insertVariable(variable.name)}
                style={{ ...btnXs, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                {`{{${variable.name}}}`}
              </button>
            ))}
            {variables.custom.map(name => (
              <button key={name} onClick={() => insertVariable(name)}
                style={{ ...btnXs, fontFamily: 'ui-monospace, monospace', fontSize: 11, borderColor: '#c7d2fe', background: '#eef2ff', color: '#4338ca' }}>
                {`{{${name}}}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isFirst && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#475569', marginTop: 12 }}>
          <input type="checkbox" checked={draft.replyToThread}
            onChange={event => change({ replyToThread: event.target.checked })} />
          Envoyer dans le fil du premier email (relance, plutôt que nouvel email)
        </label>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14 }}>
        <button style={{ ...btnPri, opacity: saved ? 0.5 : 1 }} disabled={saved}
          onClick={() => save({
            subject: draft.subject, bodyText: draft.bodyText, bodyHtml: draft.bodyHtml,
            useHtml: draft.useHtml, delayHours: draft.delayHours, replyToThread: draft.replyToThread,
          })}>
          {saved ? 'Enregistré' : 'Enregistrer cette étape'}
        </button>
        {!saved && <button style={btnDef} onClick={() => { setDraft(step); setSaved(true); }}>Annuler</button>}
      </div>
    </div>
  );
}
