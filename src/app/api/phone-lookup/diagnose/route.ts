// src/app/api/phone-lookup/diagnose/route.ts
// Diagnostic de la recherche de numéro, sur UN magasin, SANS rien écrire en base.
//
// Sert à répondre à la seule question qui compte quand une campagne ne trouve
// rien : est-ce que la source n'a pas répondu, est-ce qu'elle a répondu mais
// sans rien qui ressemble à l'enseigne, ou est-ce que des candidats existent
// mais restent sous le seuil de validation ? La réponse contient la requête
// envoyée, le code HTTP, le temps de réponse, les volumes à chaque étape du
// filtrage, et tous les candidats notés — y compris ceux écartés.
//
// Utilisation :
//   /api/phone-lookup/diagnose                 → prend une affaire au hasard
//   /api/phone-lookup/diagnose?dealId=…        → une affaire précise
//   /api/phone-lookup/diagnose?storeId=…       → un magasin précis
//   …&radius=8000                              → élargit le rayon de recherche
//   …&endpoint=https://overpass.kumi.systems/api/interpreter
//                                              → compare un autre miroir Overpass
//                                                SANS redéployer (liste blanche)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { lookupStorePhone, type StoreForLookup } from '@/lib/phone/lookup';
import { GooglePlacesError } from '@/lib/phone/google';
import { isAllowedEndpoint } from '@/lib/phone/osm';
import { USE_MOCK_DATA } from '@/lib/mockData';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STORE_SELECT = {
  id: true, name: true, city: true, postalCode: true, department: true,
  address: true, phone: true, latitude: true, longitude: true,
  brand: { select: { name: true } },
} as const;

export async function GET(req: NextRequest) {
  if (USE_MOCK_DATA) {
    return NextResponse.json({ error: 'Indisponible en mode démonstration' }, { status: 400 });
  }
  try {
    const params = req.nextUrl.searchParams;
    const dealId = params.get('dealId');
    const storeId = params.get('storeId');
    const radius = Number(params.get('radius') || 0);
    const endpoint = (params.get('endpoint') || '').trim();
    if (endpoint && !isAllowedEndpoint(endpoint)) {
      return NextResponse.json(
        { error: 'Instance Overpass non autorisée. Utilisez une instance publique connue (overpass-api.de, overpass.kumi.systems…) en https.' },
        { status: 400 },
      );
    }

    let store: StoreForLookup | null = null;
    if (storeId) {
      store = (await prisma.store.findUnique({ where: { id: storeId }, select: STORE_SELECT })) as StoreForLookup | null;
    } else if (dealId) {
      const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        select: { store: { select: STORE_SELECT } },
      });
      store = (deal?.store as StoreForLookup) ?? null;
    } else {
      // Aucun identifiant fourni : on prend le premier magasin encore sans
      // numéro, c'est-à-dire exactement le genre de cas que la campagne traite.
      const first = await prisma.store.findFirst({
        where: { phone: '', deal: { isNot: null } },
        select: STORE_SELECT,
        orderBy: { createdAt: 'asc' },
      });
      store = (first as StoreForLookup) ?? null;
    }

    if (!store) return NextResponse.json({ error: 'Magasin introuvable' }, { status: 404 });

    const result = await lookupStorePhone(store, {
      withDiagnostics: true,
      radiusMeters: radius > 0 ? radius : undefined,
      overpassEndpoint: endpoint || undefined,
    });

    return NextResponse.json({
      magasin: {
        id: store.id,
        enseigne: store.brand?.name || '(aucune)',
        nom: store.name,
        adresse: store.address,
        codePostal: store.postalCode,
        ville: store.city,
        departementEnBase: store.department,
        latitude: store.latitude,
        longitude: store.longitude,
      },
      decision: result.status,
      numeroRetenu: result.phone || null,
      erreur: result.error || null,
      // Rappelé en tête de réponse : c'est la première chose à vérifier quand
      // la campagne est lente, et la valeur configurée n'est pas forcément
      // celle qui a servi (une instance non reconnue est ignorée).
      instanceOverpassUtilisee: result.diagnostics?.osm.endpoint || null,
      instanceConfiguree: process.env.OVERPASS_ENDPOINT?.trim() || '(aucune — instance par défaut)',
      diagnostics: result.diagnostics,
      // Rappel : cette route n'écrit RIEN, elle ne modifie donc pas l'état de
      // la campagne pour ce magasin.
      persiste: false,
    });
  } catch (err) {
    if (err instanceof GooglePlacesError) {
      return NextResponse.json(
        { error: `Google Places a refusé la requête (HTTP ${err.status})`, detail: err.message },
        { status: 502 },
      );
    }
    console.error('[GET /api/phone-lookup/diagnose]', err);
    return NextResponse.json(
      { error: 'Erreur serveur', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
