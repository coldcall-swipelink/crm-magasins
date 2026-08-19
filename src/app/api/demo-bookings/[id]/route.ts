// src/app/api/demo-bookings/[id]/route.ts
// Mise à jour d'un booking de démo (table DemoBooking). Seule la case
// « NO SHOW » de la fiche affaire est modifiable : le reste de la ligne est un
// fait historique (qui a booké, quand, pour quelle date) et ne se réécrit pas.
//
// Cocher NO SHOW déclenche deux automatismes, pour que le contact non venu ne
// dorme pas dans « DEMO PREVUE » :
//   1. l'affaire bascule dans la colonne « ABSENT DEMO » ;
//   2. une action « REPROGRAMMER DEMO » est créée pour le jour même, assignée
//      à l'utilisateur qui avait booké la démo.
// Décocher la case ne défait rien : l'affaire a pu être retravaillée entre
// temps, et défaire un déplacement dans le dos de l'utilisateur serait pire
// que de le laisser corriger lui-même.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { USE_MOCK_DATA } from '@/lib/mockData';
import { recordDealMove } from '@/lib/dealMoves';
import { markDemoDoneIfNeeded } from '@/lib/demoBooking';

export const dynamic = 'force-dynamic';

/** Titre de l'action créée automatiquement (sert aussi de garde anti-doublon). */
const REPROGRAM_TITLE = 'REPROGRAMMER DEMO';

/** Normalise un titre de colonne : minuscules, sans accents, espaces réduits. */
function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Colonne « ABSENT DEMO ». Recherchée d'abord dans le pipeline de l'affaire,
 * puis partout ailleurs (l'étape peut n'exister que dans Closing). La
 * comparaison se fait sur le titre normalisé et par inclusion, pour survivre
 * aux variantes de libellé (« ABSENT DEMO », « Absent démo », « Absent démo 1 »).
 */
async function findAbsentDemoColumn(pipelineId: string) {
  const columns = await prisma.pipelineColumn.findMany({
    select: { id: true, title: true, pipelineId: true },
  });
  const matches = columns.filter((c) => normalize(c.title).includes('absent'));
  if (matches.length === 0) return null;
  const pick = (list: typeof matches) =>
    list.find((c) => normalize(c.title) === 'absent demo') ?? list[0];
  const samePipeline = matches.filter((c) => c.pipelineId === pipelineId);
  return samePipeline.length ? pick(samePipeline) : pick(matches);
}

/**
 * Date du jour à Paris, ramenée à minuit UTC — même convention que les actions
 * créées depuis l'interface (qui envoient un « AAAA-MM-JJ »), pour que
 * l'échéance tombe bien sur aujourd'hui et non sur la veille en soirée.
 */
function todayInParis(): Date {
  const day = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return new Date(`${day}T00:00:00.000Z`);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  if (typeof body?.noShow !== 'boolean') {
    return NextResponse.json({ error: 'noShow (booléen) requis' }, { status: 400 });
  }
  const noShow = body.noShow;
  // Auteur du déplacement = la personne qui coche la case (pas celle qui avait
  // booké la démo, qui hérite en revanche de l'action à faire).
  const userId = typeof body.userId === 'string' ? body.userId : null;
  const userName = typeof body.userName === 'string' ? body.userName : '';

  // Preview front sans base : rien à persister, on renvoie l'état demandé.
  if (USE_MOCK_DATA) {
    return NextResponse.json({ id: params.id, noShow, demo: true });
  }

  try {
    const before = await prisma.demoBooking.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        noShow: true,
        userId: true,
        deal: { select: { id: true, columnId: true, pipelineId: true, assignedUserId: true } },
      },
    });
    if (!before) {
      return NextResponse.json({ error: 'Booking de démo introuvable' }, { status: 404 });
    }

    const booking = await prisma.demoBooking.update({
      where: { id: params.id },
      data: { noShow },
    });

    // Les automatismes ne se déclenchent qu'au passage de « venu » à « NO SHOW ».
    if (!noShow || before.noShow) {
      return NextResponse.json({ ...booking, movedTo: null, action: null });
    }

    const deal = before.deal;
    let movedTo: { id: string; title: string } | null = null;
    let warning: string | null = null;

    const target = await findAbsentDemoColumn(deal.pipelineId);
    if (!target) {
      warning = "Aucune colonne « ABSENT DEMO » n'existe : l'affaire n'a pas été déplacée.";
    } else if (deal.columnId !== target.id) {
      await prisma.deal.update({
        where: { id: deal.id },
        data: { columnId: target.id, pipelineId: target.pipelineId, position: 0, previousColumnId: null },
      });
      // Journal des déplacements : un mouvement automatique doit apparaître
      // dans l'historique comme n'importe quel autre.
      await recordDealMove({
        dealId: deal.id,
        fromColumnId: deal.columnId,
        toColumnId: target.id,
        userId,
        userName,
        source: 'fiche',
      });
      movedTo = { id: target.id, title: target.title };
      // Même crédit que pour un déplacement manuel : celui qui coche NO SHOW
      // s'était présenté au rendez-vous.
      await markDemoDoneIfNeeded(deal.id, target.id, { userId, userName });
    }

    // Action de reprogrammation, assignée à qui avait booké la démo (repli sur
    // le responsable de l'affaire, puis sur personne). Une action de
    // reprogrammation déjà ouverte n'est pas dupliquée.
    const existing = await prisma.action.findFirst({
      where: { dealId: deal.id, status: 'todo', title: REPROGRAM_TITLE },
      select: { id: true },
    });
    const action = existing
      ? null
      : await prisma.action.create({
          data: {
            dealId: deal.id,
            title: REPROGRAM_TITLE,
            type: 'Démo',
            dueDate: todayInParis(),
            status: 'todo',
            priority: 'normale',
            note: 'Créée automatiquement au passage en NO SHOW.',
            assignedUserId: before.userId ?? deal.assignedUserId ?? null,
          },
          include: { assignedUser: true },
        });

    return NextResponse.json({ ...booking, movedTo, action, warning });
  } catch (err) {
    console.error('[PATCH /api/demo-bookings/[id]]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
