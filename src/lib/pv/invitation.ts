// src/lib/pv/invitation.ts
//
// Préparation et envoi de l'invitation « 2 CV de bouchers » pour une affaire.
//
// Deux chemins l'appellent, et c'est la raison d'être de ce fichier :
//   • le bouton de la fiche affaire (POST /api/deals/<id>/pv-invite) ;
//   • l'envoi en lot (POST /api/pv/invites), pour plusieurs magasins d'un coup.
//
// À NE PAS CONFONDRE AVEC L'OUTIL CAMPAGNES. Le modèle de mail ne peut pas être
// envoyé comme une étape de séquence : les Campagnes remplacent des variables
// dans un texte, alors qu'il faut ici CRÉER UN JETON — une ligne en base,
// rattachée à cette affaire, avec sa date d'expiration. Passé par les
// Campagnes, le modèle part avec ses variables vidées et un lien sans jeton,
// qui n'ouvre rien.

import { prisma } from '@/lib/prisma';
import { createPvInvite } from '@/lib/pv/invites';
import { ensureStoreGeo } from '@/lib/pv/geo';
import { findReferences, type PvReference } from '@/lib/pv/references';
import { countButcherProfiles } from '@/lib/pv/profiles';
import { invitationLink, renderInvitation, sendPvMail } from '@/lib/pv/mail';

/** Prénom du contact, à partir des champs de la fiche affaire. */
export function contactFirstName(deal: { directeur: string; contactCalling: string }): string {
  const source = (deal.directeur || deal.contactCalling || '').trim();
  if (!source) return '';
  const premier = source.split(/\s+/)[0];
  // « M. Dupont » : le premier mot n'est pas un prénom.
  if (/^(m|mr|mme|mlle|monsieur|madame|dr)\.?$/i.test(premier)) return '';
  return premier;
}

/** « 12 mars » — date de publication de l'offre, telle qu'affichée en bas du mail. */
function publicationDate(publishedAt: string, secours: Date): string {
  const brut = publishedAt?.trim();
  const date = brut && !Number.isNaN(new Date(brut).getTime()) ? new Date(brut) : secours;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(date);
}

export type PreparedInvitation = {
  ok: true;
  dealId: string;
  /** Adresse à qui le mail partira. */
  destinataire: string;
  magasin: string;
  references: PvReference[];
  nbProfils: number;
  contexte: {
    magasin: string;
    enseigne: string;
    ville: string;
    prenom: string;
    intituleOffre: string;
    datePublication: string;
  };
};

export type PreparationError = { ok: false; error: string };

/**
 * Rassemble tout ce qu'il faut pour écrire le mail d'un magasin : son nom, son
 * offre, son contact, ses voisins citables et le nombre de profils annoncé.
 *
 * Le magasin est géocodé au passage, une seule fois dans sa vie.
 */
export async function prepareInvitation(
  dealId: string,
): Promise<PreparedInvitation | PreparationError> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      store: { include: { brand: true } },
      jobOffers: { orderBy: { lastSeenAt: 'desc' }, take: 1 },
    },
  });
  if (!deal) return { ok: false, error: 'Affaire introuvable.' };

  const destinataire = (deal.dealEmail || deal.store.email || '').trim();
  if (!destinataire) {
    return {
      ok: false,
      error: "Cette affaire n'a pas d'adresse e-mail. Renseignez-la sur la fiche avant d'envoyer l'invitation.",
    };
  }

  const geo = await ensureStoreGeo(deal.store);
  const references = await findReferences({
    dealId: deal.id,
    brandId: deal.store.brandId,
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null,
    department: deal.store.department,
    postalCode: deal.store.postalCode,
  });

  const enseigne = deal.store.brand?.name?.trim() || '';
  const nom = deal.store.name?.trim() || '';
  const magasin = enseigne && !nom.toLowerCase().includes(enseigne.toLowerCase())
    ? `${enseigne} ${nom}`.trim()
    : nom || enseigne;
  const offre = deal.jobOffers[0];

  return {
    ok: true,
    dealId: deal.id,
    destinataire,
    magasin,
    references,
    // Calculé à l'identique de ce que figera l'invitation : l'aperçu montre
    // donc exactement le mail que recevra le directeur.
    nbProfils: countButcherProfiles({
      storeId: deal.store.id,
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
    }),
    contexte: {
      magasin,
      enseigne: enseigne || magasin,
      ville: deal.store.city || '',
      prenom: contactFirstName(deal),
      intituleOffre: offre?.jobTitle || offre?.title || 'Boucher (H/F)',
      datePublication: publicationDate(offre?.publishedAt || '', offre?.firstSeenAt || deal.createdAt),
    },
  };
}

/** Aperçu du mail, sans créer de jeton ni envoyer quoi que ce soit. */
export function previewInvitation(prep: PreparedInvitation): { subject: string; html: string } {
  const rendu = renderInvitation({
    ...prep.contexte,
    nbProfils: prep.nbProfils,
    references: prep.references,
    // Jeton factice : l'aperçu sert à juger le texte et la mise en page, pas à
    // ouvrir la page. Un vrai jeton n'est créé qu'à l'envoi.
    token: 'apercu',
  });
  return { subject: rendu.subject, html: rendu.html };
}

export type MintedInvitation = {
  inviteId: string;
  /** Jeton en clair. Lisible seulement ici : la base ne le garde que haché
   *  (recherche) et chiffré (renvoi d'un lien dans les rappels). */
  token: string;
  lien: string;
  expiresAt: Date;
  nbProfils: number;
  subject: string;
  html: string;
  text: string;
};

/**
 * Crée le jeton et REND le mail, sans l'envoyer.
 *
 * C'est la porte d'entrée du moteur des Campagnes : la cadence, la boîte
 * d'envoi, le préchauffage et les statistiques restent à lui ; le pilote
 * n'apporte que le jeton et le message.
 *
 * Les invitations précédentes de la même affaire sont révoquées : un magasin
 * n'a qu'un lien valable à la fois, celui de son dernier mail.
 */
export async function mintInvitationEmail(prep: PreparedInvitation): Promise<MintedInvitation> {
  const invite = await createPvInvite(prep.dealId);
  const rendu = renderInvitation({
    ...prep.contexte,
    nbProfils: invite.nbProfils,
    references: prep.references,
    token: invite.token,
  });
  return {
    inviteId: invite.id,
    token: invite.token,
    lien: invitationLink(invite.token),
    expiresAt: invite.expiresAt,
    nbProfils: invite.nbProfils,
    subject: rendu.subject,
    html: rendu.html,
    text: rendu.text,
  };
}

/** Marque l'invitation comme partie. Appelé une fois l'email réellement expédié. */
export async function markInvitationSent(inviteId: string, messageId: string): Promise<void> {
  await prisma.pvInvite.update({
    where: { id: inviteId },
    data: { sentAt: new Date(), messageId: messageId || '' },
  });
}

export type SentInvitation = {
  ok: boolean;
  dealId: string;
  destinataire: string;
  /** Lien du parcours, avec son vrai jeton. Seule occasion de le lire. */
  lien: string;
  nbProfils: number;
  references: number;
  expiresAt: Date;
  /** « smtp » (boîte de campagne) ou « resend ». */
  via: string;
  error?: string;
};

/**
 * Crée le jeton et envoie le mail.
 *
 * L'invitation précédente de la même affaire est révoquée : un magasin n'a
 * qu'un lien valable à la fois, celui de son dernier mail.
 */
export async function sendInvitation(
  prep: PreparedInvitation,
): Promise<SentInvitation> {
  const invite = await mintInvitationEmail(prep);

  const envoi = await sendPvMail(
    {
      to: prep.destinataire,
      subject: invite.subject,
      html: invite.html,
      text: invite.text,
      token: invite.token,
      dealId: prep.dealId,
    },
    // Message froid : il part de la boîte de campagne (domaine dédié,
    // préchauffage, cadence), pas du canal transactionnel.
    { preferMailbox: true },
  );

  if (envoi.ok) await markInvitationSent(invite.inviteId, envoi.messageId);

  return {
    ok: envoi.ok,
    dealId: prep.dealId,
    destinataire: prep.destinataire,
    lien: invite.lien,
    nbProfils: invite.nbProfils,
    references: prep.references.length,
    expiresAt: invite.expiresAt,
    via: envoi.via,
    error: envoi.error,
  };
}
