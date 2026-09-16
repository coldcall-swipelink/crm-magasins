// src/app/api/pv/_shared.ts
//
// Ce que toutes les routes publiques du parcours ont en commun.
//
// Ces routes sont les SEULES du CRM ouvertes sans authentification : elles sont
// appelées par un directeur de magasin, depuis son téléphone, sans compte. Leur
// unique garde est le jeton. D'où trois précautions systématiques :
//
//   • aucune mise en cache (ni navigateur, ni CDN, ni Next) — les créneaux
//     doivent être frais et les données d'un magasin ne doivent jamais être
//     servies à un autre ;
//   • aucune fuite d'information sur un jeton refusé : un message unique, un
//     corps vide de toute donnée ;
//   • CORS fermé par défaut, ouvert seulement au domaine de la page.

import { NextResponse } from 'next/server';
import { pvPublicBaseUrl } from '@/lib/pv/config';

/**
 * En-têtes communs.
 *
 * La page est servie par ce même domaine (CONFIG.API = "/api") : l'en-tête CORS
 * n'est donc utile qu'aux essais depuis un fichier local ou un autre
 * sous-domaine. Il reste volontairement restreint à notre domaine public.
 */
export function pvHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Access-Control-Allow-Origin': pvPublicBaseUrl(),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    Vary: 'Origin',
  };
}

export function pvJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: pvHeaders() });
}

/**
 * Réponse à un jeton inconnu, expiré ou absent.
 *
 * 403 et non 404 : le jeton existe peut-être, il n'ouvre simplement plus rien.
 * Le corps ne contient RIEN d'autre que le message — pas de nom de magasin, pas
 * d'e-mail, pas d'indice sur ce que le jeton aurait donné.
 */
export function pvForbidden(message: string): NextResponse {
  return pvJson({ error: message }, 403);
}

/** Requête préalable CORS. */
export function pvOptions(): NextResponse {
  return new NextResponse(null, { status: 204, headers: pvHeaders() });
}
