// src/lib/pv/invites.ts
//
// Création et résolution des invitations du parcours boucher.
//
// Une invitation = un magasin + un jeton + une date d'expiration. C'est le seul
// objet que la page publique sait manipuler : toutes les routes /api/pv/*
// commencent par résoudre le jeton, et s'arrêtent là s'il ne vaut rien.

import { prisma } from '@/lib/prisma';
import { generatePvToken, hashPvToken, looksLikePvToken } from '@/lib/pv/token';
import { isEncryptionConfigured, encryptSecret, tryDecryptSecret } from '@/lib/campaigns/crypto';
import { countButcherProfiles } from '@/lib/pv/profiles';
import { ensureStoreGeo } from '@/lib/pv/geo';
import { pvTokenTtlDays } from '@/lib/pv/config';

const inviteInclude = {
  deal: {
    include: {
      store: { include: { brand: true } },
      column: true,
      pipeline: true,
      // La dernière offre publiée donne l'intitulé exact du poste affiché sur
      // la page et dans le mail (« Boucher (H/F) », « Boucher charcutier »…).
      jobOffers: { orderBy: { lastSeenAt: 'desc' }, take: 1 },
    },
  },
  booking: true,
} as const;

async function loadInvite(tokenHash: string) {
  return prisma.pvInvite.findUnique({ where: { tokenHash }, include: inviteInclude });
}

export type PvInviteWithDeal = NonNullable<Awaited<ReturnType<typeof loadInvite>>>;

/** Pourquoi un jeton est refusé — le message affiché en dépend. */
export type InviteRejection = 'missing' | 'unknown' | 'expired' | 'revoked';

export type InviteLookup =
  | { ok: true; invite: PvInviteWithDeal }
  | { ok: false; reason: InviteRejection };

/**
 * Résout le jeton reçu dans l'URL.
 *
 * Volontairement avare en information : un jeton inconnu et un jeton révoqué
 * mènent au même écran côté visiteur (« ce lien n'est plus valable »). La
 * distinction ne sert qu'aux journaux du serveur.
 */
export async function resolvePvInvite(token: unknown): Promise<InviteLookup> {
  if (typeof token !== 'string' || token.length === 0) return { ok: false, reason: 'missing' };
  if (!looksLikePvToken(token)) return { ok: false, reason: 'unknown' };

  const invite = await loadInvite(hashPvToken(token));
  if (!invite) return { ok: false, reason: 'unknown' };
  if (invite.revokedAt) return { ok: false, reason: 'revoked' };
  if (invite.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  return { ok: true, invite };
}

/** Message affiché au visiteur quand le jeton ne vaut rien. */
export function rejectionMessage(reason: InviteRejection): string {
  if (reason === 'expired') {
    return "Ce lien a expiré. Écrivez-nous à hugo@swipelink.fr et nous vous en envoyons un nouveau.";
  }
  return "Ce lien n'est plus valable. Écrivez-nous à hugo@swipelink.fr et nous vous en envoyons un nouveau.";
}

export interface CreateInviteOptions {
  /** Nombre de profils annoncé. Calculé si absent. */
  nbProfils?: number;
  /** Validité, en jours. Par défaut PV_TOKEN_TTL_DAYS. */
  ttlDays?: number;
}

export interface CreatedInvite {
  id: string;
  /** Jeton EN CLAIR. Seule occasion de le lire : il n'est stocké que haché. */
  token: string;
  expiresAt: Date;
  nbProfils: number;
}

/**
 * Nouvelle invitation pour une affaire.
 *
 * Le magasin est géocodé au passage (une seule fois dans sa vie) : les
 * coordonnées servent ensuite au nombre de profils et aux références, sans que
 * la page ait à attendre un service extérieur.
 *
 * Les invitations précédentes de la même affaire sont révoquées : un magasin n'a
 * qu'un lien valable à la fois, celui de son dernier mail.
 */
export async function createPvInvite(
  dealId: string,
  options: CreateInviteOptions = {},
): Promise<CreatedInvite> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { store: true },
  });
  if (!deal) throw new Error(`Affaire introuvable : ${dealId}`);

  const geo = await ensureStoreGeo(deal.store);
  const nbProfils =
    options.nbProfils ??
    countButcherProfiles({
      storeId: deal.store.id,
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
    });

  const ttl = options.ttlDays ?? pvTokenTtlDays();
  const expiresAt = new Date(Date.now() + ttl * 24 * 3600 * 1000);
  const token = generatePvToken();

  const invite = await prisma.$transaction(async tx => {
    await tx.pvInvite.updateMany({
      where: { dealId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return tx.pvInvite.create({
      data: {
        dealId,
        tokenHash: hashPvToken(token),
        // Copie chiffrée : permet de renvoyer PLUS TARD le même lien (rappel,
        // relance) sans casser celui déjà posé dans l'agenda du directeur.
        tokenCipher: isEncryptionConfigured() ? encryptSecret(token) : '',
        expiresAt,
        nbProfils,
        email: deal.dealEmail || '',
      },
    });
  });

  return { id: invite.id, token, expiresAt, nbProfils };
}

/** Révoque toutes les invitations d'une affaire (désinscription, erreur d'envoi). */
export async function revokePvInvites(dealId: string): Promise<number> {
  const { count } = await prisma.pvInvite.updateMany({
    where: { dealId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

/**
 * Jeton en clair d'une invitation, déchiffré depuis `tokenCipher`.
 *
 * Renvoie null quand le chiffrement n'est pas configuré, ou quand la clé a
 * changé depuis l'émission. L'appelant décide alors quoi faire : les rappels
 * émettent un jeton neuf plutôt que de renoncer à l'envoi.
 */
export function inviteToken(invite: { tokenCipher: string }): string | null {
  return tryDecryptSecret(invite.tokenCipher);
}
