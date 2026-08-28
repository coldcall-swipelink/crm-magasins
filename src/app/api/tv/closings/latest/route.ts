import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Dernier closing enregistré, pour l'écran d'accueil accroché au mur (dépôt
// tv-swipelink). L'écran relève cette route en boucle et joue une animation
// quand l'identifiant renvoyé change.
//
// Route en LECTURE SEULE, volontairement à l'écart du chemin d'écriture des
// closings : brancher l'écran ne doit rien pouvoir casser dans l'enregistrement
// d'un contrat.
//
// Sans TV_FEED_TOKEN la route reste fermée, comme /api/emails/sync-replies.
export const dynamic = 'force-dynamic';

// Au-delà de ce délai, un closing n'est plus une nouvelle : il ne doit pas
// s'afficher parce qu'un écran vient d'être rallumé, ni défiler en boucle si
// plus personne ne close de la journée.
const FRAICHEUR_MIN = 10;

const euros = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

export async function GET(req: NextRequest) {
  const token = process.env.TV_FEED_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'Route fermée' }, { status: 404 });
  }
  if (req.nextUrl.searchParams.get('token') !== token) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  try {
    const event = await prisma.closingEvent.findFirst({
      where: {
        // On se repère sur createdAt, l'horodatage d'enregistrement : closingDate
        // est la date COMMERCIALE du contrat et peut être antérieure, un closing
        // saisi aujourd'hui pour un contrat du mois dernier doit quand même
        // s'afficher. Une correction ultérieure passe par un update, qui ne
        // touche pas à createdAt : elle ne rejoue donc pas à l'écran.
        createdAt: { gte: new Date(Date.now() - FRAICHEUR_MIN * 60_000) },
        // La reprise d'historique créerait des dizaines de lignes d'un coup.
        source: { not: 'backfill' },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        value: true,
        userName: true,
        user: { select: { name: true } },
        deal: {
          select: {
            store: { select: { name: true, brand: { select: { name: true } } } },
          },
        },
      },
    });

    if (!event) {
      return NextResponse.json({ id: null }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // L'enseigne est facultative : sans elle on affiche le magasin seul plutôt
    // qu'un tiret orphelin.
    const marque = event.deal.store.brand?.name;
    const magasin = event.deal.store.name;
    const titre = marque ? `${marque} — ${magasin}` : magasin;

    // userId peut être nul (closing sans closeur, ou compte supprimé depuis) :
    // userName est justement figé à l'enregistrement pour ce cas.
    const closeur = event.user?.name || event.userName || '';
    // Un montant absent est omis : afficher « 0 € » sur un mur pour un contrat
    // dont on ignore le montant serait pire que de ne rien afficher.
    const montant = event.value != null ? euros.format(event.value) : '';

    const sousTitre = [closeur && `Closé par ${closeur}`, montant]
      .filter(Boolean)
      .join(' · ');

    return NextResponse.json(
      { id: event.id, title: titre, subtitle: sousTitre },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[GET /api/tv/closings/latest]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
