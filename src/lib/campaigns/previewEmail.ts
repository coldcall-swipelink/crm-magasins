// src/lib/campaigns/previewEmail.ts
//
// L'email d'une étape, rendu comme il partira, pour un lead témoin.
//
// Sert à l'aperçu à l'écran ET à l'envoi de test : les deux doivent montrer
// exactement la même chose, sinon on teste autre chose que ce qu'on regarde.
//
// Ni pixel de suivi ni lien de désinscription : ils fausseraient les
// statistiques et pointeraient sur un message qui n'existe pas. Une étape
// « modèle boucher » est rendue avec un magasin d'exemple et sans jeton — le
// vrai jeton est créé à l'envoi réel, pour l'affaire du lead.

import { prisma } from '@/lib/prisma';
import { buildEmail, leadVariables, renderTemplate, STANDARD_VARIABLES } from '@/lib/campaigns/render';
import { renderInvitation } from '@/lib/pv/mail';

export type PreviewRequest = { stepId: string; variantId?: string; leadId?: string };

export type PreviewFailure = { ok: false; status: number; error: string };
export type PreviewSuccess = {
  ok: true;
  subject: string;
  html: string;
  text: string;
  missing: string[];
  templateKey: string;
  lead: { id: string; email: string; customFields: Record<string, unknown> };
  /** Première boîte de la campagne, active de préférence ; null si aucune. */
  mailbox: Awaited<ReturnType<typeof prisma.mailbox.findFirst>>;
  variables: { standard: typeof STANDARD_VARIABLES; custom: string[] };
};

/** Corps « 2 CV de bouchers » avec un magasin fictif : la forme, pas les données. */
function sampleInvitation() {
  return renderInvitation({
    magasin: 'E.Leclerc Montpellier Est',
    enseigne: 'E.Leclerc',
    ville: 'Montpellier',
    prenom: 'Marc',
    intituleOffre: 'Boucher (H/F)',
    datePublication: '12 mars',
    nbProfils: 78,
    references: [
      { enseigne: 'leclerc', nom: 'E.Leclerc', ville: 'Lunel', distanceKm: 24 },
      { enseigne: 'leclerc', nom: 'E.Leclerc', ville: 'Sète', distanceKm: 31 },
    ],
    token: 'apercu',
  });
}

export async function renderStepPreview(campaignId: string, req: PreviewRequest): Promise<PreviewFailure | PreviewSuccess> {
  const step = await prisma.campaignStep.findFirst({
    where: { id: req.stepId, campaignId },
    include: { variants: { orderBy: { key: 'asc' } } },
  });
  if (!step) return { ok: false, status: 404, error: 'Étape introuvable' };

  // En test A/B, l'aperçu porte sur UNE variante : celle demandée, à défaut
  // la première. Hors test, sur le contenu de l'étape.
  let content: { subject: string; bodyText: string; bodyHtml: string; useHtml: boolean } = step;
  if (step.variants.length > 0) {
    const wanted = req.variantId || '';
    content = step.variants.find(item => item.id === wanted) ?? step.variants[0];
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { mailboxes: { include: { mailbox: true } } },
  });
  if (!campaign) return { ok: false, status: 404, error: 'Campagne introuvable' };
  const boxes = campaign.mailboxes.map(link => link.mailbox);
  const mailbox = boxes.find(box => box.active) ?? boxes[0] ?? null;

  // Lead témoin : celui demandé, sinon un inscrit de la campagne, sinon le
  // dernier lead importé. Un aperçu sur des données réelles vaut mieux qu'un
  // aperçu sur « {{prenom}} ».
  const lead = req.leadId
    ? await prisma.lead.findUnique({ where: { id: req.leadId } })
    : (await prisma.campaignEnrollment.findFirst({
        where: { campaignId }, include: { lead: true }, orderBy: { createdAt: 'asc' },
      }))?.lead ?? await prisma.lead.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!lead) {
    return { ok: false, status: 422, error: "Aucun lead en base : importez au moins un contact pour voir l'aperçu." };
  }

  const variables = leadVariables(lead, mailbox ?? undefined);
  const custom = (lead.customFields && typeof lead.customFields === 'object')
    ? lead.customFields as Record<string, unknown> : {};
  const base = {
    templateKey: step.templateKey,
    lead: { id: lead.id, email: lead.email, customFields: custom },
    mailbox,
    variables: { standard: STANDARD_VARIABLES, custom: Object.keys(custom) },
  };

  if (step.templateKey === 'boucher') {
    // Même règle que le moteur : le sujet de l'étape, rendu, l'emporte sur
    // celui du modèle s'il est rempli.
    const subject = renderTemplate(content.subject.trim(), variables);
    const sample = sampleInvitation();
    return {
      ok: true, ...base,
      subject: subject.text.trim() || sample.subject,
      html: sample.html,
      text: sample.text,
      missing: subject.missing,
    };
  }

  const email = buildEmail({
    subjectTemplate: content.subject,
    bodyTemplate: content.useHtml ? content.bodyHtml : content.bodyText,
    useHtml: content.useHtml,
    variables,
    signatureHtml: mailbox?.signatureHtml,
    trackingId: null,
    unsubscribeToken: null,
  });
  return { ok: true, ...base, subject: email.subject, html: email.html, text: email.text, missing: email.missing };
}
