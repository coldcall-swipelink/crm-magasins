// scripts/backfill-bounced-opens.ts
//
// Efface les fausses « ouvertures » laissées par les rejets d'avant le
// correctif.
//
// Un rapport de non-remise cite l'email d'origine, pixel de suivi compris :
// le lire dans sa propre boîte déclenchait le pixel et comptait une ouverture
// pour un email que personne n'avait reçu. Le correctif protège les rejets
// à venir ; ce script nettoie ceux déjà en base.
//
// QUEL message est le rejeté ? Celui qui a provoqué l'arrêt de l'inscription :
// la dernière étape réellement partie d'une inscription arrêtée pour « bounce ».
// Les étapes précédentes de la même inscription ont pu être lues pour de vrai —
// une adresse peut mourir au troisième email — et leurs ouvertures sont
// conservées. Effacer une vraie ouverture serait une seconde erreur.
//
// Ce qu'il fait, par message retenu : `bouncedAt` posé, `openedAt` et
// `openCount` remis à zéro, `lastOpenedAt` du lead RECALCULÉ sur ce qui reste,
// et la ligne « Email ouvert » de la frise retirée seulement s'il ne reste
// plus aucune ouverture au lead.
//
// Idempotent : un message déjà nettoyé n'a plus d'ouverture à effacer, le
// rejouer ne change rien.
//
// Utilisation :
//   npm run opens:backfill              # simulation, n'écrit rien
//   npm run opens:backfill -- --run     # applique
import { PrismaClient } from '@prisma/client';
import { clearBouncedOpen } from '../src/lib/campaigns/bounceCleanup';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--run');

async function main() {
  // Inscriptions arrêtées par un rejet : c'est la trace laissée par le relevé
  // IMAP, et le seul lien fiable entre un bounce et un message précis.
  const bounced = await prisma.campaignEnrollment.findMany({
    where: { stopReason: 'bounced' },
    select: {
      id: true, leadId: true,
      campaign: { select: { name: true } },
      lead: { select: { email: true } },
    },
  });

  console.log(`${bounced.length} inscription(s) arrêtée(s) pour rejet.`);
  if (bounced.length === 0) {
    console.log('Rien à nettoyer.');
    return;
  }

  let examined = 0;
  let cleaned = 0;
  let alreadyClean = 0;
  let noMessage = 0;

  for (const enrollment of bounced) {
    // Le message rejeté est le DERNIER réellement parti de cette inscription.
    const last = await prisma.campaignMessage.findFirst({
      where: { enrollmentId: enrollment.id, status: 'sent' },
      orderBy: { sentAt: 'desc' },
      select: { id: true, openedAt: true, openCount: true, bouncedAt: true, stepPosition: true },
    });
    if (!last) { noMessage++; continue; }

    examined++;
    if (!last.openedAt && last.bouncedAt) { alreadyClean++; continue; }
    if (!last.openedAt) {
      // Rien à effacer, mais le message mérite sa marque : sans elle, un
      // rechargement du rapport de non-remise recréerait l'ouverture.
      if (APPLY) await clearBouncedOpen(last.id, enrollment.leadId);
      alreadyClean++;
      continue;
    }

    cleaned++;
    const who = enrollment.lead?.email ?? enrollment.leadId;
    const when = last.openedAt.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    console.log(
      `${APPLY ? 'nettoyé ' : 'à nettoyer'} — ${who} · « ${enrollment.campaign?.name ?? '?'} » `
      + `· étape ${last.stepPosition} · ouverture du ${when} (${last.openCount} vue(s))`,
    );

    if (APPLY) {
      const report = await clearBouncedOpen(last.id, enrollment.leadId);
      if (report.remainingOpens > 0) {
        console.log(`    ${report.remainingOpens} ouverture(s) conservée(s) sur d'autres messages de ce lead`);
      }
      if (report.eventsRemoved > 0) {
        console.log(`    ${report.eventsRemoved} ligne(s) « Email ouvert » retirée(s) de la frise`);
      }
    }
  }

  console.log('');
  console.log(`Inscriptions rejetées examinées : ${examined}`);
  console.log(`Fausses ouvertures ${APPLY ? 'effacées' : 'à effacer'} : ${cleaned}`);
  console.log(`Déjà propres : ${alreadyClean}`);
  if (noMessage > 0) console.log(`Sans message envoyé (rien à faire) : ${noMessage}`);
  if (!APPLY) {
    console.log('');
    console.log('Simulation — rien n\'a été écrit. Relancer avec « -- --run » pour appliquer.');
  }
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
