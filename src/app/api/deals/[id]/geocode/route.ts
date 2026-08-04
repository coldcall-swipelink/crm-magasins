import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { geocodeStore } from '@/lib/geocode';
import { USE_MOCK_DATA } from '@/lib/mockData';

// Géocode « à la demande » le magasin d'un deal, déclenché à l'ouverture de la
// fiche (en complément du géocodage par lots de la carte). Contrairement à la
// carte, on tente dès que les coordonnées sont nulles — sans se laisser bloquer
// par un éventuel échec précédemment mis en cache — ce qui rattrape les
// magasins restés non localisés (timeout/rate-limit BAN lors d'un gros import).
// Le repli progressif (adresse → code postal + ville → ville seule) est géré
// par geocodeStore.
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (USE_MOCK_DATA) {
    return NextResponse.json({ located: false, skipped: true });
  }
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: params.id },
      include: { store: true },
    });
    if (!deal) return NextResponse.json({ error: 'Affaire non trouvée' }, { status: 404 });

    const store = deal.store;
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
