// scripts/backfill-demo-done.ts
//
// Remplit rétroactivement « qui a fait la démo » (DemoBooking.doneBy*) à partir
// du journal des déplacements (DealMove). Avant l'ajout de ces colonnes,
// l'information n'existait que sous forme de mouvement « → DEMO FAITE » ou
// « → ABSENT DEMO » ; ce script la fige sur le booking correspondant.
//
// Rattachement : chaque mouvement de dénouement est attribué au booking qui le
// précède, la fenêtre d'un booking s'arrêtant au booking suivant (un rebooking
// ouvre donc une nouvelle fenêtre). Seules les lignes encore vides sont
// touchées : une valeur déjà enregistrée par l'application fait foi.
//
// Utilisation :
//   npm run demos:backfill              # simulation, n'écrit rien
//   npm run demos:backfill -- --run     # applique
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--run');

function normalize(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/** Vrai si le mouvement clôt une démo : « DEMO FAITE » ou « ABSENT DEMO ». */
function isOutcome(title: string): boolean {
  const t = normalize(title);
  return t === 'demo faite' || t.includes('absent');
}

async function main() {
  const bookings = await prisma.demoBooking.findMany({
    where: { doneAt: null },
    select: { id: true, dealId: true, bookedAt: true },
    orderBy: [{ dealId: 'asc' }, { bookedAt: 'asc' }],
  });
  if (bookings.length === 0) {
    console.log('Rien à rattraper : tous les bookings ont déjà un dénouement.');
    return;
  }

  const dealIds = Array.from(new Set(bookings.map(b => b.dealId)));
  console.log(`${bookings.length} booking(s) sans dénouement, sur ${dealIds.length} affaire(s).`);

  // Tous les bookings des affaires concernées : il faut les bookings VOISINS
  // (même déjà remplis) pour délimiter correctement les fenêtres.
  const allBookings = await prisma.demoBooking.findMany({
    where: { dealId: { in: dealIds } },
    select: { id: true, dealId: true, bookedAt: true },
    orderBy: [{ dealId: 'asc' }, { bookedAt: 'asc' }],
  });
  const moves = await prisma.dealMove.findMany({
    where: { dealId: { in: dealIds } },
    select: { dealId: true, toColumnTitle: true, userId: true, userName: true, movedAt: true },
    orderBy: { movedAt: 'asc' },
  });

  const bookingsByDeal = new Map<string, typeof allBookings>();
  for (const b of allBookings) {
    const list = bookingsByDeal.get(b.dealId) ?? [];
    list.push(b);
    bookingsByDeal.set(b.dealId, list);
  }
  const movesByDeal = new Map<string, typeof moves>();
  for (const m of moves) {
    if (!isOutcome(m.toColumnTitle)) continue;
    const list = movesByDeal.get(m.dealId) ?? [];
    list.push(m);
    movesByDeal.set(m.dealId, list);
  }

  const toFill = new Set(bookings.map(b => b.id));
  let filled = 0;
  let untouched = 0;

  for (const dealId of dealIds) {
    const list = bookingsByDeal.get(dealId) ?? [];
    const outcomes = movesByDeal.get(dealId) ?? [];
    for (let i = 0; i < list.length; i++) {
      const booking = list[i];
      if (!toFill.has(booking.id)) continue;
      const from = booking.bookedAt.getTime();
      const until = list[i + 1]?.bookedAt.getTime() ?? Number.POSITIVE_INFINITY;
      const hit = outcomes.find(m => m.movedAt.getTime() >= from && m.movedAt.getTime() < until);
      if (!hit) { untouched += 1; continue; }
      filled += 1;
      if (APPLY) {
        await prisma.demoBooking.update({
          where: { id: booking.id },
          data: { doneByUserId: hit.userId, doneByName: hit.userName || '', doneAt: hit.movedAt },
        });
      } else {
        console.log(`  ${booking.id} ← ${hit.userName || '(sans auteur)'} le ${hit.movedAt.toISOString().slice(0, 10)}`);
      }
    }
  }

  console.log(`${filled} booking(s) ${APPLY ? 'remplis' : 'à remplir'}, ${untouched} sans mouvement de dénouement (démo pas encore faite).`);
  if (!APPLY) console.log('Simulation : relancer avec « -- --run » pour appliquer.');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
