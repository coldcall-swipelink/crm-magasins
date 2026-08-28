// scripts/backfill-closing-events.ts
//
// Reprend l'historique des closings dans la table ClosingEvent. Avant elle, un
// closing n'existait que sous la forme de colonnes sur l'abonnement
// (closingDate, closedByUserId, closedByName) : ce script crée la ligne
// d'évènement correspondante pour chaque abonnement DÉJÀ daté.
//
// Ce qu'il ne fait pas : inventer une date d'enregistrement. `recordedAt` est
// posé à la date de closing elle-même (et non à la date du jour), pour que les
// lignes reprises se placent au bon endroit dans le fil d'activité. La source
// est marquée "backfill" pour les distinguer des closings enregistrés en direct.
//
// Idempotent : un abonnement qui a déjà sa ligne d'évènement est laissé tel
// quel — une valeur enregistrée par l'application fait foi.
//
// Utilisation :
//   npm run closings:backfill              # simulation, n'écrit rien
//   npm run closings:backfill -- --run     # applique
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--run');

async function main() {
  const subs = await prisma.subscription.findMany({
    where: { closingDate: { not: null }, closingEvent: null },
    select: {
      id: true, dealId: true, closingDate: true, value: true,
      subscriptionType: true, closedByUserId: true, closedByName: true,
    },
    orderBy: { closingDate: 'asc' },
  });

  if (subs.length === 0) {
    console.log('Rien à reprendre : tous les abonnements datés ont déjà leur évènement de closing.');
    return;
  }
  console.log(`${subs.length} closing(s) à reprendre.`);

  // Les comptes supprimés depuis ne doivent pas faire échouer la clé étrangère :
  // on garde le nom figé sur la ligne, sans le lien vers l'utilisateur.
  const users = await prisma.user.findMany({ select: { id: true } });
  const knownUsers = new Set(users.map(u => u.id));

  let sansCloseur = 0;
  for (const sub of subs) {
    const userId = sub.closedByUserId && knownUsers.has(sub.closedByUserId) ? sub.closedByUserId : null;
    if (!userId && !sub.closedByName) sansCloseur += 1;
    if (APPLY) {
      await prisma.closingEvent.create({
        data: {
          dealId: sub.dealId,
          subscriptionId: sub.id,
          userId,
          userName: sub.closedByName || '',
          closingDate: sub.closingDate!,
          value: sub.value,
          subscriptionType: sub.subscriptionType || '',
          source: 'backfill',
          recordedAt: sub.closingDate!,
        },
      });
    } else {
      const qui = sub.closedByName || '(closeur non renseigné)';
      console.log(`  ${sub.id} ← ${qui} le ${sub.closingDate!.toISOString().slice(0, 10)}`);
    }
  }

  console.log(`${subs.length} closing(s) ${APPLY ? 'repris' : 'à reprendre'}, dont ${sansCloseur} sans closeur renseigné.`);
  if (!APPLY) console.log('Simulation : relancer avec « -- --run » pour appliquer.');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
