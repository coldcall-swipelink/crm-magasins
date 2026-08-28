import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { searchKey } from '@/lib/searchText';

// Dernier évènement à célébrer sur l'écran d'accueil accroché au mur (dépôt
// tv-swipelink). L'écran relève cette route en boucle et joue une animation
// quand l'identifiant renvoyé change.
//
// Deux évènements y passent : un closing enregistré (ClosingEvent) et une démo
// bookée (DemoBooking). On renvoie le plus récent des deux, avec un `kind` qui
// dit à l'écran quel texte afficher et quelle bande sonore jouer.
//
// Route en LECTURE SEULE, volontairement à l'écart des chemins d'écriture :
// brancher l'écran ne doit rien pouvoir casser dans l'enregistrement d'un
// contrat ni dans celui d'un booking.
//
// Sans TV_FEED_TOKEN la route reste fermée, comme /api/emails/sync-replies.
export const dynamic = 'force-dynamic';

// Au-delà de ce délai, un évènement n'est plus une nouvelle : il ne doit pas
// s'afficher parce qu'un écran vient d'être rallumé, ni rester à l'affiche
// toute une journée creuse.
const FRAICHEUR_MIN = 10;

const euros = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

// L'enseigne est facultative : sans elle on affiche le magasin seul plutôt
// qu'un tiret orphelin.
function libelleMagasin(store: { name: string; brand: { name: string } | null }) {
  return store.brand?.name ? `${store.brand.name} — ${store.name}` : store.name;
}

// userId peut être nul (évènement sans auteur, ou compte supprimé depuis) :
// userName est justement figé à l'enregistrement pour ce cas.
function auteur(user: { name: string } | null, userName: string) {
  return user?.name || userName || '';
}

const magasinSelect = {
  deal: { select: { store: { select: { name: true, brand: { select: { name: true } } } } } },
} as const;

export async function GET(req: NextRequest) {
  const token = process.env.TV_FEED_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'Route fermée' }, { status: 404 });
  }
  if (req.nextUrl.searchParams.get('token') !== token) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  try {
    // On se repère sur createdAt, l'horodatage d'enregistrement. Pour un
    // closing, closingDate est la date COMMERCIALE du contrat et peut être
    // antérieure. Pour un booking, demoDate, noShow et doneBy* sont renseignés
    // APRÈS coup sur la même ligne : se repérer sur updatedAt ferait rejouer
    // une démo à l'écran le jour où elle a lieu.
    const depuis = new Date(Date.now() - FRAICHEUR_MIN * 60_000);

    const [closing, demo] = await Promise.all([
      prisma.closingEvent.findFirst({
        // La reprise d'historique créerait des dizaines de lignes d'un coup.
        where: { createdAt: { gte: depuis }, source: { not: 'backfill' } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, createdAt: true, value: true, userName: true,
          user: { select: { name: true } },
          ...magasinSelect,
        },
      }),
      prisma.demoBooking.findFirst({
        where: { createdAt: { gte: depuis } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, createdAt: true, userName: true,
          user: { select: { name: true } },
          ...magasinSelect,
        },
      }),
    ]);

    // Le plus récent des deux l'emporte. Deux évènements à quelques secondes
    // d'intervalle ne donnent donc qu'une célébration : c'est la limite d'un
    // flux qui expose un état plutôt qu'une file, et elle est assumée.
    const gagnant =
      closing && demo ? (closing.createdAt >= demo.createdAt ? 'closing' : 'demo')
      : closing ? 'closing'
      : demo ? 'demo'
      : null;

    if (!gagnant) {
      return NextResponse.json({ id: null }, { headers: { 'Cache-Control': 'no-store' } });
    }

    let corps;
    if (gagnant === 'closing' && closing) {
      const qui = auteur(closing.user, closing.userName);
      // Un montant absent est omis : afficher « 0 € » sur un mur pour un
      // contrat dont on ignore le montant serait pire que de ne rien afficher.
      const montant = closing.value != null ? euros.format(closing.value) : '';
      corps = {
        id: closing.id,
        // Horodatage de l'évènement : l'écran interroge maintenant deux
        // sources — ce CRM pour les closings et les démos, le dashboard CSM
        // pour les messages clients — et les départage sur cette date.
        at: closing.createdAt.toISOString(),
        kind: 'closing',
        kicker: '',
        title: libelleMagasin(closing.deal.store),
        subtitle: [qui && `Closé par ${qui}`, montant].filter(Boolean).join(' · '),
        closer: qui,
        closerKey: searchKey(qui),
      };
    } else if (demo) {
      const qui = auteur(demo.user, demo.userName);
      corps = {
        id: demo.id,
        at: demo.createdAt.toISOString(),
        kind: 'demo',
        kicker: 'Nouvelle démo bookée',
        title: libelleMagasin(demo.deal.store),
        subtitle: qui ? `Bravo ${qui}` : '',
        closer: qui,
        closerKey: searchKey(qui),
      };
    }

    return NextResponse.json(corps, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[GET /api/tv/closings/latest]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
