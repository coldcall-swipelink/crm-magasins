// src/app/api/deals/[id]/find-phone/route.ts
// Recherche à l'unité du numéro du magasin, déclenchée depuis la fiche affaire
// (bouton « Trouver le numéro »). Même cascade que la campagne de masse — cf.
// src/lib/phone/lookup.ts — mais resserrée autour des coordonnées du magasin,
// donc quasi instantanée.
//
// Un numéro sûr est renseigné directement dans l'affaire (si le champ est vide) ;
// les cas douteux sont renvoyés tels quels pour que l'utilisateur choisisse.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { lookupStorePhone, applyLookupResult, type StoreForLookup } from '@/lib/phone/lookup';
import { GooglePlacesError } from '@/lib/phone/google';
import { USE_MOCK_DATA } from '@/lib/mockData';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (USE_MOCK_DATA) {
    return NextResponse.json({ status: 'introuvable', phone: '', candidates: [] });
  }
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        contactPhone: true,
        store: {
          select: {
            id: true, name: true, city: true, postalCode: true, department: true,
            address: true, phone: true, latitude: true, longitude: true,
            brand: { select: { name: true } },
          },
        },
      },
    });
    if (!deal) return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });

    const store = deal.store as StoreForLookup;

    // Le magasin porte déjà un numéro (import, campagne, validation manuelle) :
    // inutile de relancer une recherche, on le propose tel quel.
    if (store.phone.trim()) {
      return NextResponse.json({
        status: 'trouve', phone: store.phone, source: 'connu', candidates: [], alreadyKnown: true,
      });
    }

    const result = await lookupStorePhone(store);
    await applyLookupResult(prisma, result);

    return NextResponse.json({
      status: result.status,
      phone: result.phone,
      source: result.source,
      candidates: result.candidates,
    });
  } catch (err) {
    if (err instanceof GooglePlacesError) {
      return NextResponse.json(
        { error: `Google Places a refusé la requête (HTTP ${err.status}). Vérifiez GOOGLE_PLACES_API_KEY.` },
        { status: 502 },
      );
    }
    console.error('[POST /api/deals/[id]/find-phone]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
