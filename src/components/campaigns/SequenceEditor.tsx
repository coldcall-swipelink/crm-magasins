'use client';
// src/components/campaigns/SequenceEditor.tsx
//
// Éditeur de la séquence d'une campagne, en deux volets, à la manière des
// outils de prospection (Lemlist) :
//
//   • à gauche, le SCHÉMA de la séquence — chaque email, le délai qui le
//     précède, et l'on clique sur une étape pour l'ouvrir ;
//   • à droite, l'ÉDITEUR de l'étape ouverte — sujet, corps, modèle, délai.
//
// On voit ainsi toute la séquence pendant qu'on rédige une étape, et l'on
// passe de l'une à l'autre sans rien perdre : chaque étape garde son
// brouillon tant qu'il n'est pas enregistré, et le schéma signale d'un point
// les étapes qui ont des modifications en attente.
//
// Deux modes de rédaction par étape : un corps TEXTE (converti en HTML sobre
// à l'envoi — le plus sûr pour la délivrabilité) ou un corps HTML libre pour
// un email commercial. Les variables {{prenom}}, {{enseigne}}… fonctionnent
// dans les deux, et l'aperçu montre le rendu sur un vrai lead.
//
// Test A/B : une étape peut porter plusieurs VARIANTES (A, B, C, D) du sujet
// et du corps. Le moteur les répartit équitablement entre les leads, et
// l'onglet Statistiques les compare. Ici, l'éditeur affiche une variante à la
// fois, avec des onglets pour passer de l'une à l'autre ; le délai, le fil de
// discussion et le modèle restent ceux de l'étape. On clôt le test en
// « gardant » une variante : elle devient l'étape, les autres disparaissent.

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { STANDARD_VARIABLES } from '@/lib/campaigns/render';
import { T, btnDef, btnPri, btnXs, formatDelay, inp, label, modal, overlay } from './ui';

/** Une version concurrente d'une étape en test A/B. */
export interface Variant {
  id: string;
  key: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  useHtml: boolean;
  active: boolean;
}

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
  /** Lettre gardée à la clôture du dernier test A/B ('' sinon). */
  abWinner: string;
  /** Variantes du test A/B en cours ; vide = étape simple. */
  variants: Variant[];
}

/** Au plus quatre variantes par étape — la même limite que le serveur. */
const MAX_VARIANTS = 4;

type Variable = { name: string; description: string };
type Variables = { standard: Variable[]; custom: string[] };

/** Délais proposés en un clic — les plus courants en prospection. */
const DELAY_PRESETS = [
  { hours: 0, label: 'Immédiat' },
  { hours: 48, label: '2 jours' },
  { hours: 72, label: '3 jours' },
  { hours: 120, label: '5 jours' },
  { hours: 168, label: '7 jours' },
];

function stepTitle(step: Step): string {
  return step.position === 1 ? 'Premier email' : `Relance ${step.position - 1}`;
}

/** Champs de l'étape édités ici. Les variantes ont leurs propres brouillons. */
const STEP_FIELDS: Array<keyof Step> = ['delayHours', 'subject', 'bodyText', 'bodyHtml', 'useHtml', 'replyToThread', 'templateKey'];
const VARIANT_FIELDS: Array<keyof Variant> = ['subject', 'bodyText', 'bodyHtml', 'useHtml'];

/** Une étape a-t-elle été modifiée par rapport à ce qui est en base ? */
function isDirty(draft: Step, saved: Step): boolean {
  return STEP_FIELDS.some(key => draft[key] !== saved[key]);
}

function isVariantDirty(draft: Variant, saved: Variant): boolean {
  return VARIANT_FIELDS.some(key => draft[key] !== saved[key]);
}

/** Le contenu d'une étape ou d'une variante est-il rédigé ? */
function hasContent(content: { subject: string; bodyText: string; bodyHtml: string; useHtml: boolean }, templateKey: string): boolean {
  if (templateKey) return true;
  return Boolean(content.subject.trim() && (content.useHtml ? content.bodyHtml.trim() : content.bodyText.trim()));
}

export default function SequenceEditor({ campaignId, steps, onChanged }: {
  campaignId: string;
  steps: Step[];
  onChanged: () => void;
}) {
  // Les variables du CRM sont connues d'avance ; celles propres aux leads
  // (colonnes personnalisées de l'import) arrivent avec le premier aperçu.
  const [variables, setVariables] = useState<Variables>({ standard: [...STANDARD_VARIABLES], custom: [] });
  const [preview, setPreview] = useState<{ stepId: string; variantKey: string; subject: string; html: string; missing: string[]; from: string | null; lead: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(steps[0]?.id ?? null);
  // Variante ouverte, par étape : on retrouve B en revenant sur l'étape.
  const [openVariant, setOpenVariant] = useState<Record<string, string>>({});

  // Brouillons par étape. Ils vivent ici, et non dans l'éditeur, pour deux
  // raisons : on change d'étape sans perdre ce qu'on écrivait, et le schéma
  // de gauche peut afficher le sujet en cours de frappe et le point
  // « non enregistré ».
  const [drafts, setDrafts] = useState<Record<string, Step>>(() =>
    Object.fromEntries(steps.map(step => [step.id, step])));
  // Brouillons par variante, même principe.
  const [variantDrafts, setVariantDrafts] = useState<Record<string, Variant>>(() =>
    Object.fromEntries(steps.flatMap(step => step.variants.map(variant => [variant.id, variant]))));

  // Quand la campagne se recharge (après un enregistrement, un ajout, une
  // suppression), on aligne les brouillons sur la base — sauf ceux qui ont
  // des modifications en attente : recharger l'étape 1 ne doit pas effacer
  // ce qu'on écrivait dans l'étape 2. La liste des variantes, elle, vient
  // toujours de la base : elle ne s'édite pas dans le brouillon.
  useEffect(() => {
    setDrafts(previous => {
      const next: Record<string, Step> = {};
      for (const step of steps) {
        const draft = previous[step.id];
        next[step.id] = draft && isDirty(draft, step)
          ? { ...draft, position: step.position, variants: step.variants, abWinner: step.abWinner }
          : step;
      }
      return next;
    });
    setVariantDrafts(previous => {
      const next: Record<string, Variant> = {};
      for (const step of steps) {
        for (const variant of step.variants) {
          const draft = previous[variant.id];
          next[variant.id] = draft && isVariantDirty(draft, variant) ? { ...draft, active: variant.active } : variant;
        }
      }
      return next;
    });
    setSelectedId(current => (current && steps.some(step => step.id === current)) ? current : (steps[0]?.id ?? null));
  }, [steps]);

  const selected = steps.find(step => step.id === selectedId) ?? null;
  const draft = selected ? (drafts[selected.id] ?? selected) : null;

  const variantsOf = (step: Step): Variant[] => step.variants.map(variant => variantDrafts[variant.id] ?? variant);
  const stepDirty = (step: Step): boolean =>
    Boolean(drafts[step.id] && isDirty(drafts[step.id], step))
    || step.variants.some(variant => variantDrafts[variant.id] && isVariantDirty(variantDrafts[variant.id], variant));
  const dirtyIds = new Set(steps.filter(stepDirty).map(step => step.id));

  const changeDraft = (stepId: string, patch: Partial<Step>) => {
    setDrafts(previous => ({ ...previous, [stepId]: { ...(previous[stepId] ?? steps.find(step => step.id === stepId)!), ...patch } }));
  };
  const changeVariant = (variantId: string, patch: Partial<Variant>) => {
    setVariantDrafts(previous => ({ ...previous, [variantId]: { ...previous[variantId], ...patch } }));
  };

  const resetDraft = (step: Step) => {
    setDrafts(previous => ({ ...previous, [step.id]: step }));
    setVariantDrafts(previous => ({
      ...previous,
      ...Object.fromEntries(step.variants.map(variant => [variant.id, variant])),
    }));
  };

  const addStep = async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/steps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok) { toast('Ajout impossible', 'error'); return; }
    const data = await res.json().catch(() => ({}));
    // On ouvre tout de suite la relance qu'on vient d'ajouter : c'est pour
    // la rédiger qu'on l'a créée.
    if (data?.step?.id) setSelectedId(data.step.id);
    onChanged();
  };

  /**
   * Enregistre l'étape ET ses variantes modifiées, d'un seul bouton : pour
   * l'utilisateur, c'est « cette étape » qu'il enregistre, quel que soit
   * l'onglet A/B ouvert. Renvoie false si le serveur a refusé quelque chose.
   */
  const save = useCallback(async (step: Step, quiet = false): Promise<boolean> => {
    const current = drafts[step.id] ?? step;
    let ok = true;

    if (isDirty(current, step)) {
      // Tout le brouillon, SAUF ce qui ne s'édite pas ici. Énumérer les
      // champs un par un se désynchronise du formulaire dès qu'on en ajoute
      // un : c'est ainsi que le choix du modèle se perdait à l'enregistrement,
      // en silence, puisque la sauvegarde réussissait. Le serveur filtre déjà
      // ce qu'il accepte.
      const { id, position, variants, abWinner, ...patch } = current;
      void position; void variants; void abWinner;
      const res = await fetch(`/api/campaigns/${campaignId}/steps/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) ok = false;
    }

    for (const variant of step.variants) {
      const vDraft = variantDrafts[variant.id];
      if (!vDraft || !isVariantDirty(vDraft, variant)) continue;
      const { id, key, active, ...patch } = vDraft;
      void key; void active;
      const res = await fetch(`/api/campaigns/${campaignId}/steps/${step.id}/variants/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) ok = false;
    }

    if (!ok) { toast('Enregistrement refusé', 'error'); return false; }
    if (!quiet) toast(`${stepTitle(step)} enregistré${step.position === 1 ? '' : 'e'}`);
    onChanged();
    return true;
  }, [campaignId, drafts, variantDrafts, onChanged]);

  const remove = async (step: Step) => {
    if (!confirm(`Supprimer « ${stepTitle(step)} » ?`)) return;
    const res = await fetch(`/api/campaigns/${campaignId}/steps/${step.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Suppression impossible', 'error'); return; }
    // On ouvre l'étape voisine plutôt que de laisser le volet vide.
    const index = steps.findIndex(item => item.id === step.id);
    const neighbour = steps[index + 1] ?? steps[index - 1] ?? null;
    setSelectedId(neighbour?.id ?? null);
    onChanged();
  };

  // ─── Test A/B ────────────────────────────────────────────────────────────

  const addVariant = async (step: Step, copyFrom?: string) => {
    // La variante A naît du contenu EN BASE de l'étape : ce qu'on vient de
    // taper doit y être, sinon il serait perdu. On enregistre d'abord.
    if (dirtyIds.has(step.id) && !(await save(step, true))) return;
    const res = await fetch(`/api/campaigns/${campaignId}/steps/${step.id}/variants`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(copyFrom ? { copyFrom } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || 'Ajout impossible', 'error'); return; }
    if (data?.variant?.id) setOpenVariant(previous => ({ ...previous, [step.id]: data.variant.id }));
    toast(step.variants.length === 0
      ? 'Test A/B ouvert : rédigez la variante B'
      : `Variante ${data.variant.key} ajoutée`);
    onChanged();
  };

  const toggleVariant = async (step: Step, variant: Variant) => {
    const res = await fetch(`/api/campaigns/${campaignId}/steps/${step.id}/variants/${variant.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !variant.active }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || 'Modification refusée', 'error'); return; }
    toast(variant.active ? `Variante ${variant.key} en pause : elle ne reçoit plus d'envoi` : `Variante ${variant.key} réactivée`);
    onChanged();
  };

  const promoteVariant = async (step: Step, variant: Variant) => {
    const others = step.variants.filter(item => item.id !== variant.id).map(item => item.key).join(', ');
    if (!confirm(`Garder la variante ${variant.key} et clore le test ?\n\nElle devient le texte de l'étape ; la ou les variantes ${others} seront supprimées. Les statistiques du test restent consultables.`)) return;
    // Ses modifications en attente partent avec elle.
    if (dirtyIds.has(step.id) && !(await save(step, true))) return;
    const res = await fetch(`/api/campaigns/${campaignId}/steps/${step.id}/variants/${variant.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promote: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || 'Clôture impossible', 'error'); return; }
    toast(`Test clos : la variante ${variant.key} devient l'étape`);
    onChanged();
  };

  const deleteVariant = async (step: Step, variant: Variant) => {
    const last = step.variants.length <= 2;
    const remaining = step.variants.find(item => item.id !== variant.id);
    if (!confirm(last && remaining
      ? `Retirer la variante ${variant.key} ? Il ne restera que ${remaining.key} : le test sera clos et ${remaining.key} deviendra l'étape.`
      : `Retirer la variante ${variant.key} du test ?`)) return;
    const res = await fetch(`/api/campaigns/${campaignId}/steps/${step.id}/variants/${variant.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || 'Suppression impossible', 'error'); return; }
    toast(data.promoted ? `Test clos : la variante ${data.promoted} devient l'étape` : `Variante ${variant.key} retirée`);
    onChanged();
  };

  const showPreview = async (step: Step, variantId?: string) => {
    // L'aperçu est rendu par le serveur sur la version EN BASE : ce qu'on
    // vient de taper n'y est pas tant que ce n'est pas enregistré.
    if (dirtyIds.has(step.id)) toast('Aperçu de la version enregistrée — enregistrez pour voir vos modifications');
    const res = await fetch(`/api/campaigns/${campaignId}/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: step.id, variantId }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Aperçu indisponible', 'error'); return; }
    setVariables(data.variables);
    setPreview({
      stepId: step.id,
      variantKey: step.variants.find(variant => variant.id === variantId)?.key ?? '',
      subject: data.preview.subject,
      html: data.preview.html,
      missing: data.preview.missing,
      from: data.preview.from,
      lead: data.preview.lead.email,
    });
  };

  return (
    <div className="camp-seq" style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* ---- Volet gauche : le schéma de la séquence ---- */}
      <div className="camp-seq-flow" style={{
        width: 340, flexShrink: 0, borderRight: `1px solid ${T.border}`, background: T.bgPanel,
        overflowY: 'auto', padding: '18px 20px 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Séquence</div>
          <div style={{ fontSize: 11.5, color: T.textFaint }}>
            {steps.length} email{steps.length > 1 ? 's' : ''}
          </div>
          {dirtyIds.size > 0 && (
            <div style={{ marginLeft: 'auto', fontSize: 11, color: T.warnText, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.warn, display: 'inline-block' }} />
              {dirtyIds.size} non enregistré{dirtyIds.size > 1 ? 's' : ''}
            </div>
          )}
        </div>

        <FlowNode>
          <div style={{ fontSize: 11, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Départ</div>
          <div style={{ fontSize: 12.5, color: T.textMuted, marginTop: 2 }}>Dès l&apos;inscription du lead</div>
        </FlowNode>

        {steps.map(step => {
          const current = drafts[step.id] ?? step;
          const active = step.id === selectedId;
          const dirty = dirtyIds.has(step.id);
          const testing = step.variants.length > 0;
          const subjectOf = (content: { subject: string }) => current.templateKey === 'boucher'
            ? (content.subject.trim() || '2 CV de bouchers pour votre magasin')
            : content.subject.trim();
          const subject = subjectOf(current);
          return (
            <div key={step.id}>
              <FlowConnector
                label={step.position === 1 ? 'Envoi immédiat' : `Attendre ${formatDelay(current.delayHours)}`}
                muted={step.position === 1}
              />
              <button
                onClick={() => setSelectedId(step.id)}
                className="camp-seq-node"
                style={{
                  display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                  background: active ? T.surfaceHi : T.surface,
                  border: `1px solid ${active ? T.primary : T.border}`,
                  boxShadow: active ? `0 0 0 3px ${T.primarySoft}` : 'none',
                  borderRadius: 10, padding: '10px 12px', color: T.text,
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: 7, flexShrink: 0,
                    background: active ? T.primary : T.primarySoft, color: active ? '#fff' : T.primaryText,
                    fontSize: 11.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{step.position}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>{stepTitle(step)}</div>
                  {testing && (
                    <span title={`Test A/B : ${step.variants.length} variantes`}
                      style={{ fontSize: 10.5, fontWeight: 700, color: T.violetText, background: T.violetSoft, borderRadius: 999, padding: '1px 7px' }}>
                      A/B ×{step.variants.length}
                    </span>
                  )}
                  {current.templateKey === 'boucher' && (
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: T.violetText, background: T.violetSoft, borderRadius: 999, padding: '1px 7px' }}>
                      Modèle
                    </span>
                  )}
                  {dirty && (
                    <span title="Modifications non enregistrées"
                      style={{ width: 8, height: 8, borderRadius: '50%', background: T.warn, flexShrink: 0 }} />
                  )}
                </div>
                {testing ? (
                  // Une ligne par variante : on voit d'un coup d'œil ce qui
                  // est en concurrence, et ce qui est en pause.
                  <div style={{ marginTop: 6, paddingLeft: 33, display: 'grid', gap: 2 }}>
                    {variantsOf(step).map(variant => {
                      const text = subjectOf(variant);
                      return (
                        <div key={variant.id} style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 12, minWidth: 0 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: variant.active ? T.violetText : T.textFaint, flexShrink: 0 }}>{variant.key}</span>
                          <span style={{
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            color: !variant.active ? T.textFaint : text ? T.textMuted : T.textFaint,
                            fontStyle: text ? 'normal' : 'italic',
                            textDecoration: variant.active ? 'none' : 'line-through',
                          }}>{text || 'Sans sujet'}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{
                    fontSize: 12, marginTop: 6, paddingLeft: 33, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    color: subject ? T.textMuted : T.textFaint, fontStyle: subject ? 'normal' : 'italic',
                  }}>
                    {subject || 'Sans sujet'}
                  </div>
                )}
                {step.position > 1 && current.replyToThread && current.templateKey !== 'boucher' && (
                  <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 3, paddingLeft: 33 }}>↳ dans le fil du premier email</div>
                )}
              </button>
            </div>
          );
        })}

        <FlowConnector label="" muted />
        <button style={{ ...btnDef, width: '100%', justifyContent: 'center', borderStyle: 'dashed' }} onClick={addStep}>
          + Ajouter une relance
        </button>
      </div>

      {/* ---- Volet droit : l'éditeur de l'étape ouverte ---- */}
      <div className="camp-seq-editor" style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        {selected && draft ? (
          <StepEditor
            key={selected.id}
            step={selected}
            draft={draft}
            variants={variantsOf(selected)}
            variantId={openVariant[selected.id] ?? null}
            dirty={dirtyIds.has(selected.id)}
            canDelete={steps.length > 1}
            variables={variables}
            onChange={patch => changeDraft(selected.id, patch)}
            onChangeVariant={changeVariant}
            onSelectVariant={id => setOpenVariant(previous => ({ ...previous, [selected.id]: id }))}
            onAddVariant={copyFrom => addVariant(selected, copyFrom)}
            onToggleVariant={variant => toggleVariant(selected, variant)}
            onPromoteVariant={variant => promoteVariant(selected, variant)}
            onDeleteVariant={variant => deleteVariant(selected, variant)}
            onSave={() => save(selected)}
            onReset={() => resetDraft(selected)}
            onDelete={() => remove(selected)}
            onPreview={variantId => showPreview(selected, variantId)}
          />
        ) : (
          <div style={{ padding: 32, fontSize: 13, color: T.textFaint }}>
            Aucune étape : ajoutez un premier email dans le volet de gauche.
          </div>
        )}
      </div>

      {preview && (
        <div style={overlay}
          onClick={() => setPreview(null)}>
          <div onClick={event => event.stopPropagation()} style={{ ...modal, width: 'min(720px, 100%)', maxHeight: '88vh', overflow: 'auto' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              Aperçu sur un lead réel
              {preview.variantKey && (
                <span style={{ fontSize: 10.5, fontWeight: 700, color: T.violetText, background: T.violetSoft, borderRadius: 999, padding: '1px 8px' }}>
                  Variante {preview.variantKey}
                </span>
              )}
            </div>
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

/** Nœud « Départ » du schéma. */
function FlowNode({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '9px 12px' }}>
      {children}
    </div>
  );
}

/** Trait vertical entre deux nœuds, avec le délai posé dessus. */
function FlowConnector({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: label ? '6px 0' : '4px 0' }}>
      <div style={{ width: 1, height: 10, background: T.border }} />
      {label && (
        <div style={{
          fontSize: 11, padding: '3px 10px', borderRadius: 999, margin: '2px 0',
          border: `1px solid ${T.border}`, background: T.surface,
          color: muted ? T.textFaint : T.textMuted, fontWeight: muted ? 500 : 600,
        }}>
          {label}
        </div>
      )}
      <div style={{ width: 1, height: 10, background: T.border }} />
    </div>
  );
}

function StepEditor({
  step, draft, variants, variantId, dirty, canDelete, variables,
  onChange, onChangeVariant, onSelectVariant, onAddVariant, onToggleVariant, onPromoteVariant, onDeleteVariant,
  onSave, onReset, onDelete, onPreview,
}: {
  step: Step;
  draft: Step;
  /** Brouillons des variantes de l'étape (vide hors test). */
  variants: Variant[];
  variantId: string | null;
  dirty: boolean;
  canDelete: boolean;
  variables: Variables;
  onChange: (patch: Partial<Step>) => void;
  onChangeVariant: (variantId: string, patch: Partial<Variant>) => void;
  onSelectVariant: (variantId: string) => void;
  onAddVariant: (copyFrom?: string) => void;
  onToggleVariant: (variant: Variant) => void;
  onPromoteVariant: (variant: Variant) => void;
  onDeleteVariant: (variant: Variant) => void;
  onSave: () => void;
  onReset: () => void;
  onDelete: () => void;
  onPreview: (variantId?: string) => void;
}) {
  const isFirst = step.position === 1;
  const testing = variants.length > 0;
  // La variante ouverte, ou la première : l'onglet mémorisé peut avoir été
  // supprimé entre-temps.
  const variant = testing ? (variants.find(item => item.id === variantId) ?? variants[0]) : null;
  // Ce qu'éditent les champs Sujet et Corps : la variante ouverte en test,
  // l'étape elle-même sinon.
  const content = variant ?? draft;
  const changeContent = (patch: Partial<Variant> & Partial<Step>) =>
    variant ? onChangeVariant(variant.id, patch) : onChange(patch);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  // Dernier champ touché : la variable cliquée s'insère là où on écrivait.
  const lastFocus = useRef<'subject' | 'body'>('body');

  /** Insère {{variable}} à l'endroit du curseur, dans le champ actif. */
  const insertVariable = (name: string) => {
    const token = `{{${name}}}`;
    if (lastFocus.current === 'subject' && subjectRef.current) {
      const field = subjectRef.current;
      const start = field.selectionStart ?? field.value.length;
      const next = field.value.slice(0, start) + token + field.value.slice(field.selectionEnd ?? start);
      changeContent({ subject: next });
    } else if (bodyRef.current) {
      const field = bodyRef.current;
      const start = field.selectionStart ?? field.value.length;
      const next = field.value.slice(0, start) + token + field.value.slice(field.selectionEnd ?? start);
      changeContent(content.useHtml ? { bodyHtml: next } : { bodyText: next });
    }
  };

  const toggle = (active: boolean): React.CSSProperties => ({
    ...btnXs,
    borderColor: active ? T.primary : T.border,
    background: active ? T.primarySoft : T.surfaceAlt,
    color: active ? T.primaryText : T.textMuted,
  });

  const emptyVariants = variants.filter(item => item.active && !hasContent(item, draft.templateKey));

  return (
    <div style={{ padding: '0 24px 32px', maxWidth: 860 }}>
      {/* En-tête de l'étape, collé en haut : le bouton Enregistrer reste à
          portée quand le corps du message est long. */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 2, margin: '0 -24px 16px', padding: '14px 24px',
        background: T.bg, borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: T.primarySoft, color: T.primaryText, fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {step.position}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{stepTitle(step)}</div>
          <div style={{ fontSize: 11.5, color: T.textFaint }}>
            {isFirst ? 'Part dès l\'inscription du lead' : `${formatDelay(draft.delayHours)} après l'email précédent`}
            {testing && <span style={{ color: T.violetText }}> · test A/B, {variants.length} variantes</span>}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {dirty && <button style={btnXs} onClick={onReset}>Annuler</button>}
          <button style={btnXs} onClick={() => onPreview(variant?.id)}>Aperçu{variant ? ` ${variant.key}` : ''}</button>
          {canDelete && <button style={{ ...btnXs, borderColor: 'rgba(239,68,68,.35)', background: T.dangerSoft, color: T.dangerText }} onClick={onDelete}>Supprimer</button>}
          <button style={{ ...btnPri, padding: '6px 13px', fontSize: 12.5 }} disabled={!dirty} onClick={onSave}>
            {dirty ? 'Enregistrer' : 'Enregistré'}
          </button>
        </div>
      </div>

      {!isFirst && (
        <div style={{ marginBottom: 14 }}>
          <label style={label}>Attendre avant cet email</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {DELAY_PRESETS.filter(preset => preset.hours > 0).map(preset => (
              <button key={preset.hours} onClick={() => onChange({ delayHours: preset.hours })}
                style={toggle(draft.delayHours === preset.hours)}>{preset.label}</button>
            ))}
            <input style={{ ...inp, width: 90 }} type="number" min={0} value={draft.delayHours}
              onChange={event => onChange({ delayHours: Number(event.target.value) })} />
            <span style={{ fontSize: 12, color: T.textFaint }}>heures</span>
          </div>
        </div>
      )}

      {/* Modèle du CRM. Une étape « boucher » n'a pas de corps à rédiger : son
          contenu vient du pilote, et le moteur crée un jeton par magasin à
          l'envoi — ce qu'aucune étape libre ne sait faire. */}
      <div style={{ marginBottom: 14 }}>
        <label style={label}>Modèle</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {([['', 'Libre'], ['boucher', 'Parcours boucher (2 CV)']] as const).map(([key, libelle]) => (
            <button key={key} onClick={() => onChange({ templateKey: key })} style={toggle(draft.templateKey === key)}>{libelle}</button>
          ))}
        </div>
      </div>

      {/* ─── Test A/B ───────────────────────────────────────────────────── */}
      {testing && variant ? (
        <div style={{ marginBottom: 14, border: `1px solid ${T.violet}55`, background: T.violetSoft, borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.violetText, textTransform: 'uppercase', letterSpacing: '.04em', marginRight: 4 }}>Test A/B</span>
            {variants.map(item => {
              const open = item.id === variant.id;
              return (
                <button key={item.id} onClick={() => onSelectVariant(item.id)}
                  title={item.active ? `Variante ${item.key}` : `Variante ${item.key} — en pause`}
                  style={{
                    ...btnXs, fontWeight: 700, minWidth: 34, justifyContent: 'center',
                    borderColor: open ? T.violet : T.border,
                    background: open ? T.violet : T.surfaceAlt,
                    color: open ? '#fff' : item.active ? T.text : T.textFaint,
                    textDecoration: item.active ? 'none' : 'line-through',
                  }}>
                  {item.key}
                </button>
              );
            })}
            {variants.length < MAX_VARIANTS && (
              <button style={{ ...btnXs, borderStyle: 'dashed' }} onClick={() => onAddVariant(variant.id)}
                title={`Nouvelle variante, copiée de ${variant.key}`}>
                + Variante
              </button>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <button style={btnXs} onClick={() => onToggleVariant(variant)}>
                {variant.active ? 'Mettre en pause' : 'Réactiver'}
              </button>
              <button style={{ ...btnXs, borderColor: `${T.success}66`, background: T.successSoft, color: '#4ade80' }} onClick={() => onPromoteVariant(variant)}>
                Garder {variant.key}
              </button>
              <button style={{ ...btnXs, borderColor: 'rgba(239,68,68,.35)', background: T.dangerSoft, color: T.dangerText }} onClick={() => onDeleteVariant(variant)}>
                Retirer
              </button>
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 8, lineHeight: 1.5 }}>
            Chaque lead reçoit UNE variante, tirée pour répartir les envois à parts égales.
            {draft.templateKey
              ? ' Sur une étape à modèle, seul le sujet varie.'
              : ' Le délai et le fil de discussion restent ceux de l\'étape.'}
            {' '}L&apos;onglet <b style={{ color: T.text }}>Statistiques</b> compare les variantes ;
            « Garder » clôt le test sur la gagnante.
          </div>
          {!variant.active && (
            <div style={{ fontSize: 11.5, color: T.warnText, marginTop: 6 }}>
              La variante {variant.key} est en pause : elle ne reçoit plus d&apos;envoi, ses chiffres restent visibles.
            </div>
          )}
          {emptyVariants.length > 0 && (
            <div style={{ fontSize: 11.5, color: T.warnText, marginTop: 6 }}>
              {emptyVariants.length === 1
                ? `La variante ${emptyVariants[0].key} n'est pas rédigée : elle ne partira pas tant qu'elle n'a pas un sujet et un corps.`
                : `Les variantes ${emptyVariants.map(item => item.key).join(', ')} ne sont pas rédigées : elles ne partiront pas tant qu'elles n'ont pas un sujet et un corps.`}
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button style={{ ...btnXs, borderColor: `${T.violet}66`, background: T.violetSoft, color: T.violetText, fontWeight: 600 }}
            onClick={() => onAddVariant()}>
            Tester une autre version (A/B)
          </button>
          <span style={{ fontSize: 11.5, color: T.textFaint }}>
            {step.abWinner
              ? `Dernier test clos : variante ${step.abWinner} gardée.`
              : 'Deux sujets ou deux textes en concurrence, envoyés à parts égales.'}
          </span>
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <label style={label}>Sujet{variant ? ` — variante ${variant.key}` : ''}</label>
        <input ref={subjectRef} style={inp} value={content.subject}
          onFocus={() => { lastFocus.current = 'subject'; }}
          placeholder={draft.templateKey === 'boucher'
            ? '2 CV de bouchers pour votre magasin {{Enseigne}} — laissez vide pour celui du modèle'
            : 'Une question sur {{enseigne}}'}
          onChange={event => changeContent({ subject: event.target.value })} />
        {!isFirst && draft.replyToThread && (
          <div style={{ fontSize: 11, color: T.textFaint, marginTop: 4 }}>
            Cette relance part dans le fil du premier email : c&apos;est son sujet, préfixé « Re: », qui sera utilisé.
          </div>
        )}
      </div>

      {draft.templateKey === 'boucher' ? (
        <div style={{ border: '1px solid rgba(59,113,245,.38)', background: 'rgba(59,113,245,.10)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 12.5, color: '#b3b9c9', lineHeight: 1.6 }}>
            Le corps vient du modèle du pilote et se personnalise magasin par magasin :
            nom du magasin, nombre de bouchers repérés, clients voisins cités, intitulé de
            l&apos;offre — et <b style={{ color: T.primaryText }}>un lien de réservation propre à chaque
            magasin</b>, créé au moment de l&apos;envoi.
          </div>
          <div style={{ fontSize: 11.5, color: T.textFaint, lineHeight: 1.6, marginTop: 8 }}>
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
            <label style={{ ...label, marginBottom: 0 }}>Corps du message{variant ? ` — variante ${variant.key}` : ''}</label>
            <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
              <button onClick={() => changeContent({ useHtml: false })} style={toggle(!content.useHtml)}>Texte</button>
              <button onClick={() => changeContent({ useHtml: true })} style={toggle(content.useHtml)}>HTML</button>
            </div>
          </div>
          <textarea
            ref={bodyRef}
            style={{ ...inp, minHeight: content.useHtml ? 320 : 300, resize: 'vertical',
              fontFamily: content.useHtml ? 'ui-monospace, monospace' : undefined,
              fontSize: content.useHtml ? 12 : 13.5, lineHeight: 1.55, padding: '12px 14px' }}
            value={content.useHtml ? content.bodyHtml : content.bodyText}
            onFocus={() => { lastFocus.current = 'body'; }}
            placeholder={content.useHtml
              ? '<p>Bonjour {{prenom|bonjour}},</p>'
              : 'Bonjour {{prenom|bonjour}},\n\nJe vous écris parce que…'}
            onChange={event => changeContent(content.useHtml ? { bodyHtml: event.target.value } : { bodyText: event.target.value })}
          />
          <div style={{ fontSize: 11, color: T.textFaint, marginTop: 5 }}>
            {content.useHtml
              ? 'HTML libre : idéal pour un email commercial. Un email trop maquetté passe moins bien les filtres qu\'un email simple.'
              : 'Texte simple, converti en HTML sobre à l\'envoi — c\'est le format qui arrive le mieux en boîte de réception.'}
          </div>
        </>
      )}

      {draft.templateKey === '' && (variables.standard.length > 0 || variables.custom.length > 0) && (
        <div style={{ marginTop: 12 }}>
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
                style={{ ...btnXs, fontFamily: 'ui-monospace, monospace', fontSize: 11, borderColor: 'rgba(59,113,245,.38)', background: T.primarySoft, color: T.primaryText }}>
                {`{{${name}}}`}
              </button>
            ))}
          </div>
          {variables.custom.length === 0 && (
            <div style={{ fontSize: 11, color: T.textFaint, marginTop: 5 }}>
              Les colonnes personnalisées de vos leads apparaîtront ici après un premier « Aperçu ».
            </div>
          )}
        </div>
      )}

      {!isFirst && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#b3b9c9', marginTop: 14 }}>
          <input type="checkbox" checked={draft.replyToThread}
            onChange={event => onChange({ replyToThread: event.target.checked })} />
          Envoyer dans le fil du premier email (relance, plutôt que nouvel email)
        </label>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 18 }}>
        <button style={btnPri} disabled={!dirty} onClick={onSave}>
          {dirty ? 'Enregistrer cette étape' : 'Enregistré'}
        </button>
        {dirty && <button style={btnDef} onClick={onReset}>Annuler</button>}
      </div>
    </div>
  );
}
