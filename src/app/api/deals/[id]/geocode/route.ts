import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildGeocodeQuery, geocodeStore } from '@/lib/geocode';
import { USE_MOCK_DATA } from '@/lib/mockData';

// Géocode « à la demande » le magasin d'un deal, déclenché à l'ouverture de la
// fiche (en complément du géocodage par lots de la carte). Contrairement à la
// carte, on tente dès que les coordonnées sont nulles — sans se laisser bloquer
// par un éventuel échec précédemment mis en cache — ce qui rattrape les
// magasins restés non localisés (timeout/rate-limit BAN lors d'un gros import).
// Le repli progressif (adresse → code postal + ville → ville seule) est géré
// par geocodeStore.
//
// La carte utilise en plus le mode MANUEL : quand le corps de la requête porte
// des coordonnées (`{ latitude, longitude }`), on les enregistre telles
// quelles, sans passer par la BAN. C'est le bouton « Localiser » de la liste
// latérale, qui permet de placer à la main un magasin dont l'adresse est
// introuvable. Le géocodage automatique ne les écrasera pas : `geocodeQuery`
// est marqué comme résolu pour l'adresse courante.
export const dynamic = 'force-dynamic';

/** Coordonnées exploitables trouvées dans le corps de la requête, sinon null. */
function parseCoords(body: unknown): { latitude: number; longitude: number } | null {
  if (!body || typeof body !== 'object') return null;
  const { latitude, longitude } = body as Record<string, unknown>;
  const lat = typeof latitude === 'number' ? latitude : Number(latitude);
  const lng = typeof longitude === 'number' ? longitude : Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (USE_MOCK_DATA) {
    return NextResponse.json({ located: false, skipped: true });
  }
  try {
    // Corps optionnel : la fiche affaire appelle la route sans corps.
    const body = await req.json().catch(() => null);
    const manual = parseCoords(body);

    const deal = await prisma.deal.findUnique({
      where: { id: params.id },
      include: { store: true },
    });
    if (!deal) return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });

    const store = deal.store;

    // ── Localisation manuelle : on écrit les coordonnées fournies ──────────
    if (manual) {
      await prisma.store.update({
        where: { id: store.id },
        data: {
          latitude: manual.latitude,
          longitude: manual.longitude,
          // Marque l'adresse courante comme résolue (même valeur que celle
          // calculée par la carte) : le géocodage par lots ne repassera pas
          // dessus pour écraser le choix manuel. Seule une modification de
          // l'adresse du magasin relancera un géocodage automatique.
          geocodeQuery: buildGeocodeQuery(store) || 'manuel',
          geocodedAt: new Date(),
        },
      });
      return NextResponse.json({
        located: true,
        manual: true,
        latitude: manual.latitude,
        longitude: manual.longitude,
      });
    }

    // Déjà localisé : rien à faire (cas le plus fréquent, réponse instantanée).
    if (store.latitude != null && store.longitude != null) {
      return NextResponse.json({
        located: true,
        alreadyLocated: true,
        latitude: store.latitude,
        longitude: store.longitude,
      });
    }

    const geo = await geocodeStore({
      address: store.address,
      postalCode: store.postalCode,
      city: store.city,
    });

    if (!geo) {
      // Aucune variante n'a abouti (adresse/ville non résolues ou BAN
      // injoignable). On ne persiste pas l'échec : la prochaine ouverture du
      // deal réessaiera.
      return NextResponse.json({ located: false });
    }

    await prisma.store.update({
      where: { id: store.id },
      data: {
        latitude: geo.latitude,
        longitude: geo.longitude,
        geocodeQuery: geo.usedQuery,
        geocodedAt: new Date(),
      },
    });

    return NextResponse.json({ located: true, latitude: geo.latitude, longitude: geo.longitude });
  } catch (err) {
    console.error('[POST /api/deals/[id]/geocode]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
