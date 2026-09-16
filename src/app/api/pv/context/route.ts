// GET /api/pv/context?t=<jeton>
//
// Tout ce que la page affiche avant que le directeur ne touche à quoi que ce
// soit : son magasin, le nombre de profils repérés, son adresse e-mail, le
// consultant qu'il verra, et jusqu'à trois clients voisins de la même enseigne.
//
// La page appelle cette route au chargement, mais ne l'attend pas : le nom du
// magasin et le nombre de profils sont déjà dans le HTML servi (cf.
// src/app/boucher/route.ts). Ce qui arrive ici complète l'écran sans le bloquer.

import { NextRequest } from 'next/server';
import { pvConsultant } from '@/lib/pv/config';
import { ensureStoreGeo } from '@/lib/pv/geo';
import { rejectionMessage, resolvePvInvite } from '@/lib/pv/invites';
import { brandSlug } from '@/lib/pv/brands';
import { findReferences } from '@/lib/pv/references';
import { libelleMagasin } from '@/lib/pv/bookings';
import { pvForbidden, pvJson, pvOptions } from '../_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const OPTIONS = pvOptions;

export async function GET(req: NextRequest) {
  const lookup = await resolvePvInvite(req.nextUrl.searchParams.get('t'));
  if (!lookup.ok) return pvForbidden(rejectionMessage(lookup.reason));

  const { invite } = lookup;
  const store = invite.deal.store;

  try {
    // Géocodage à la première ouverture seulement : ensuite, c'est en base.
    const geo = await ensureStoreGeo(store);

    const references = await findReferences({
      dealId: invite.dealId,
      brandId: store.brandId,
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
    });

    // L'offre publiée donne l'intitulé exact du poste, quand on l'a.
    const offre = invite.deal.jobOffers?.[0];

    return pvJson({
      magasin: libelleMagasin(invite),
      enseigne: brandSlug(store.brand?.name),
      ville: store.city || '',
      poste: offre?.jobTitle || offre?.title || 'Boucher (H/F)',
      email: invite.email || invite.deal.dealEmail || '',
      telephone: invite.deal.contactPhone || store.phone || '',
      nbProfils: invite.nbProfils,
      consultant: pvConsultant(),
      references,
    });
  } catch (err) {
    console.error('[GET /api/pv/context]', err);
    return pvJson({ error: 'Contexte indisponible' }, 500);
  }
}
