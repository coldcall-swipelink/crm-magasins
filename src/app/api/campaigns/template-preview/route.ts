// GET /api/campaigns/template-preview?key=boucher
//
// Aperçu d'un modèle fourni par le CRM, rendu avec des valeurs d'exemple.
//
// Sert à l'éditeur de séquence : une étape « modèle boucher » n'a pas de corps
// rédigé à relire, puisque son contenu est écrit par le pilote et personnalisé
// magasin par magasin à l'envoi. Cet aperçu montre la forme exacte du message,
// avec un magasin fictif.
//
// Aucune donnée réelle n'y transite, et aucun jeton n'est créé : le lien du
// bouton porte « apercu », qui n'ouvre rien.

import { NextRequest, NextResponse } from 'next/server';
import { renderInvitation } from '@/lib/pv/mail';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key') || '';
  if (key !== 'boucher') {
    return NextResponse.json({ error: `Modèle inconnu : « ${key} »` }, { status: 404 });
  }

  const rendu = renderInvitation({
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

  return new NextResponse(rendu.html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
