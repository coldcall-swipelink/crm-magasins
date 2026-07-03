// src/app/api/dashboard/diagnose-mrr/route.ts
// Diagnostic (lecture seule) de l'écart « total colonne SMARTLINKÉ » vs « MRR
// dashboard ». Ouvrable dans le navigateur : /api/dashboard/diagnose-mrr
//
// Les deux chiffres n'ont pas le même critère :
//  - Total colonne SMARTLINKÉ  = dealValue des affaires ACTUELLEMENT dans la
//    colonne (+ sous-deals). Critère : être dans la colonne.
//  - MRR dashboard             = valeur des abonnements dont closingDate est
//    renseignée, TOUTES colonnes confondues. Critère : avoir une date de closing.
//
// L'écart se décompose en :
//  (B) MRR > colonne : abonnements DATÉS hors colonne SMARTLINKÉ (affaire closée
//      puis déplacée, date posée hors colonne, sous-deal dont le parent n'y est
//      pas) → gonflent le MRR sans compter dans la colonne.
//  (A) colonne > MRR : abonnements NON datés dans la colonne → gonflent la colonne.
//  (C) dérive : dealValue ≠ somme des abonnements du deal.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function isSmartlink(title?: string | null): boolean {
  if (!title) return false;
  return title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes('smartlink');
}
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export async function GET() {
  const smartlinkCols = (await prisma.pipelineColumn.findMany({ select: { id: true, title: true } }))
    .filter(c => isSmartlink(c.title));
  if (!smartlinkCols.length) {
    return NextResponse.json({ error: 'Aucune colonne SMARTLINKÉ trouvée.' }, { status: 404 });
  }
  const colIdSet = new Set(smartlinkCols.map(c => c.id));

  // ---- Total de colonne (exactement le calcul du PipelineBoard) ----
  const colDeals = await prisma.deal.findMany({
    where: { columnId: { in: Array.from(colIdSet) }, parentDealId: null },
    select: {
      id: true, dealValue: true,
      store: { select: { name: true } },
      subscriptions: { select: { value: true, closingDate: true, position: true } },
      childDeals: {
        select: {
          dealValue: true,
          store: { select: { name: true } },
          subscriptions: { select: { value: true, closingDate: true, position: true } },
        },
      },
    },
  });
  const colTotal = colDeals.reduce(
    (s, d) => s + (d.dealValue || 0) + d.childDeals.reduce((c, x) => c + (x.dealValue || 0), 0),
    0,
  );

  // ---- MRR : tous les abonnements datés + leur colonne effective ----
  const datedSubs = await prisma.subscription.findMany({
    where: { closingDate: { not: null } },
    select: {
      value: true, closingDate: true, position: true,
      deal: {
        select: {
          columnId: true, parentDealId: true,
          store: { select: { name: true } },
          column: { select: { title: true } },
          parentDeal: { select: { columnId: true } },
        },
      },
    },
  });
  const mrrTotal = datedSubs.reduce((s, x) => s + (x.value || 0), 0);

  // (B) MRR > colonne : datés hors colonne SMARTLINKÉ.
  const inSmartlinkView = (d: (typeof datedSubs)[number]['deal']) =>
    (d.parentDealId == null && colIdSet.has(d.columnId)) ||
    (d.parentDealId != null && !!d.parentDeal && colIdSet.has(d.parentDeal.columnId));
  const gonfleMrr = datedSubs
    .filter(s => (s.value || 0) !== 0 && !inSmartlinkView(s.deal))
    .map(s => ({
      magasin: s.deal.store?.name ?? '—',
      colonneActuelle: s.deal.column?.title ?? '?',
      positionAbo: s.position,
      valeur: round2(s.value || 0),
      dateClosing: s.closingDate,
    }))
    .sort((a, b) => b.valeur - a.valeur);

  // (A) colonne > MRR : non datés dans la colonne.
  const gonfleColonne: { magasin: string; type: string; positionAbo: number; valeur: number }[] = [];
  const pushUndated = (magasin: string, type: string, subs: { value: number | null; closingDate: Date | null; position: number }[]) => {
    for (const s of subs) if (!s.closingDate && (s.value || 0) !== 0) gonfleColonne.push({ magasin, type, positionAbo: s.position, valeur: round2(s.value || 0) });
  };
  for (const d of colDeals) {
    pushUndated(d.store?.name ?? '—', 'affaire', d.subscriptions);
    for (const c of d.childDeals) pushUndated(c.store?.name ?? '—', 'sous-deal', c.subscriptions);
  }
  gonfleColonne.sort((a, b) => b.valeur - a.valeur);

  // (C) dérive de dénormalisation.
  const derive = colDeals
    .map(d => ({ magasin: d.store?.name ?? '—', dealValue: round2(d.dealValue || 0), sommeAbos: round2(d.subscriptions.reduce((s, x) => s + (x.value || 0), 0)) }))
    .filter(d => Math.abs(d.dealValue - d.sommeAbos) > 0.001)
    .map(d => ({ ...d, ecart: round2(d.dealValue - d.sommeAbos) }));

  return NextResponse.json({
    resume: {
      totalColonneSmartlink: round2(colTotal),
      mrrTotalDashboard: round2(mrrTotal),
      ecart_colonne_moins_mrr: round2(colTotal - mrrTotal),
      nbAffairesColonne: colDeals.length,
      nbAbonnementsDatés: datedSubs.length,
    },
    B_datesHorsColonne_gonflentLeMRR: {
      sousTotal: round2(gonfleMrr.reduce((s, o) => s + o.valeur, 0)),
      lignes: gonfleMrr,
    },
    A_nonDatesDansColonne_gonflentLaColonne: {
      sousTotal: round2(gonfleColonne.reduce((s, o) => s + o.valeur, 0)),
      lignes: gonfleColonne,
    },
    C_deriveDenormalisation: derive,
    generatedAt: new Date().toISOString(),
  });
}
