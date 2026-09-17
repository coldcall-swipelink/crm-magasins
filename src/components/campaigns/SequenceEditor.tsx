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
import { T, btnDef, btnPri, btnXs, card, formatDelay, inp, label, modal, overlay } from './ui';

export interface Step {
  id: string;
  position: number;
  delayHours: number;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  useHtml: boolean;
  replyToThread: boolean;
  /** Modèle fourni par le CRM : '' = étape libre, 'boucher' = invitation « 2 CV ». */
  templateKey: string;
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
        <div style={overlay}
          onClick={() => setPreview(null)}>
          <div onClick={event => event.stopPropagation()} style={{ ...modal, width: 'min(720px, 100%)', maxHeight: '88vh', overflow: 'auto' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Aperçu sur un lead réel</div>
            <div style={{ fontSize: 12, color: '#9aa1b4', marginBottom: 4 }}>De : {preview.from || '— aucune boîte affectée —'}</div>
            <div style={{ fontSize: 12, color: '#9aa1b4', marginBottom: 10 }}>À : {preview.lead}</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, padding: '8px 0', borderTop: '1px solid #262b38', borderBottom: '1px solid #262b38', marginBottom: 12 }}>
              {preview.subject || <span style={{ color: '#f87171' }}>(sujet vide)</span>}
            </div>
            {preview.missing.length > 0 && (
              <div style={{ background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.35)', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#fbbf24', marginBottom: 12 }}>
                Variables sans valeur pour ce lead : {preview.missing.map(name => `{{${name}}}`).join(', ')}.
                Donnez-leur une valeur de repli — <code>{'{{prenom|bonjour}}'}</code> — pour éviter les phrases bancales.
              </div>
            )}
            {/* Fond blanc assumé : c'est l'email tel que le lead le recevra. */}
            <div className="camp-email-preview" style={{ border: `1px solid ${T.border}`, padding: 16 }}
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
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(59,113,245,.16)', color: '#8fb0ff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {step.position}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>
          {isFirst ? 'Premier email' : `Relance ${step.position - 1}`}
        </div>
        <div style={{ fontSize: 12, color: '#9aa1b4' }}>
          {isFirst ? '— part dès l\'inscription du lead' : `— ${formatDelay(draft.delayHours)} après l'email précédent`}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button style={btnXs} onClick={onPreview}>Aperçu</button>
          {canDelete && <button style={{ ...btnXs, borderColor: 'rgba(239,68,68,.35)', background: 'rgba(239,68,68,.13)', color: '#f87171' }} onClick={remove}>Supprimer</button>}
        </div>
      </div>

      {!isFirst && (
        <div style={{ marginBottom: 12 }}>
          <label style={label}>Attendre avant cet email</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {DELAY_PRESETS.filter(preset => preset.hours > 0).map(preset => (
              <button key={preset.hours} onClick={() => change({ delayHours: preset.hours })} style={{
                ...btnXs,
                borderColor: draft.delayHours === preset.hours ? '#3b71f5' : '#262b38',
                background: draft.delayHours === preset.hours ? 'rgba(59,113,245,.16)' : '#1c1f2a',
                color: draft.delayHours === preset.hours ? '#8fb0ff' : '#9aa1b4',
              }}>{preset.label}</button>
            ))}
            <input style={{ ...inp, width: 90 }} type="number" min={0} value={draft.delayHours}
              onChange={event => change({ delayHours: Number(event.target.value) })} />
            <span style={{ fontSize: 12, color: '#6b7283' }}>heures</span>
          </div>
        </div>
      )}

      {/* Modèle du CRM. Une étape « boucher » n'a pas de corps à rédiger : son
          contenu vient du pilote, et le moteur crée un jeton par magasin à
          l'envoi — ce qu'aucune étape libre ne sait faire. */}
      <div style={{ marginBottom: 12 }}>
        <label style={label}>Modèle</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {([['', 'Libre'], ['boucher', 'Parcours boucher (2 CV)']] as const).map(([key, libelle]) => (
            <button key={key} onClick={() => change({ templateKey: key })} style={{
              ...btnXs,
              borderColor: draft.templateKey === key ? '#3b71f5' : '#262b38',
              background: draft.templateKey === key ? 'rgba(59,113,245,.16)' : '#1c1f2a',
              color: draft.templateKey === key ? '#8fb0ff' : '#9aa1b4',
            }}>{libelle}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={label}>Sujet</label>
        <input ref={subjectRef} style={inp} value={draft.subject}
          onFocus={() => { lastFocus.current = 'subject'; }}
          placeholder={draft.templateKey === 'boucher'
            ? '2 CV de bouchers pour votre magasin {{Enseigne}} — laissez vide pour celui du modèle'
            : 'Une question sur {{enseigne}}'}
          onChange={event => change({ subject: event.target.value })} />
        {!isFirst && draft.replyToThread && (
          <div style={{ fontSize: 11, color: '#6b7283', marginTop: 4 }}>
            Cette relance part dans le fil du premier email : c&apos;est son sujet, préfixé « Re: », qui sera utilisé.
          </div>
        )}
      </div>

      {draft.templateKey === 'boucher' ? (
        <div style={{ border: '1px solid rgba(59,113,245,.38)', background: 'rgba(59,113,245,.10)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 12.5, color: '#b3b9c9', lineHeight: 1.6 }}>
            Le corps vient du modèle du pilote et se personnalise magasin par magasin :
            nom du magasin, nombre de bouchers repérés, clients voisins cités, intitulé de
            l&apos;offre — et <b style={{ color: '#8fb0ff' }}>un lien de réservation propre à chaque
            magasin</b>, créé au moment de l&apos;envoi.
          </div>
          <div style={{ fontSize: 11.5, color: '#6b7283', lineHeight: 1.6, marginTop: 8 }}>
            Un lead sans affaire rattachée est écarté de la séquence (motif « aucune affaire
            rattachée ») : sans magasin, son lien n&apos;ouvrirait rien. Les leads ajoutés par
            « + Depuis le CRM » portent déjà la leur.
          </div>
          <a href="/api/campaigns/template-preview?key=boucher" target="_blank" rel="noopener"
            style={{ ...btnXs, display: 'inline-block', marginTop: 10, textDecoration: 'none' }}>
            Aperçu du mail
          </a>
        </div>
      ) : (
      <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
        <label style={{ ...label, marginBottom: 0 }}>Corps du message</label>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <button onClick={() => change({ useHtml: false })} style={{
            ...btnXs,
            borderColor: !draft.useHtml ? '#3b71f5' : '#262b38',
            background: !draft.useHtml ? 'rgba(59,113,245,.16)' : '#1c1f2a',
            color: !draft.useHtml ? '#8fb0ff' : '#9aa1b4',
          }}>Texte</button>
          <button onClick={() => change({ useHtml: true })} style={{
            ...btnXs,
            borderColor: draft.useHtml ? '#3b71f5' : '#262b38',
            background: draft.useHtml ? 'rgba(59,113,245,.16)' : '#1c1f2a',
            color: draft.useHtml ? '#8fb0ff' : '#9aa1b4',
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
      <div style={{ fontSize: 11, color: '#6b7283', marginTop: 5 }}>
        {draft.useHtml
          ? 'HTML libre : idéal pour un email commercial. Un email trop maquetté passe moins bien les filtres qu\'un email simple.'
          : 'Texte simple, converti en HTML sobre à l\'envoi — c\'est le format qui arrive le mieux en boîte de réception.'}
      </div>
      </>
      )}

      {draft.templateKey === '' && (variables.standard.length > 0 || variables.custom.length > 0) && (
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
                style={{ ...btnXs, fontFamily: 'ui-monospace, monospace', fontSize: 11, borderColor: 'rgba(59,113,245,.38)', background: 'rgba(59,113,245,.16)', color: '#8fb0ff' }}>
                {`{{${name}}}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isFirst && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#b3b9c9', marginTop: 12 }}>
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
