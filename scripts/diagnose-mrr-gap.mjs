// Diagnostic de l'écart « total colonne SMARTLINKÉ » vs « MRR dashboard ».
//
// Les deux chiffres ne mesurent PAS la même chose :
//  - Total colonne SMARTLINKÉ (PipelineBoard) = dealValue des affaires
//    ACTUELLEMENT dans la colonne (+ dealValue de leurs sous-deals). Critère :
//    être dans la colonne. Aucun filtre de date.
//  - MRR dashboard (api/dashboard/closing) = valeur des ABONNEMENTS dont
//    closingDate est renseignée, TOUTES colonnes confondues. Critère : avoir
//    une date de closing.
//
// L'écart se décompose donc en deux termes indépendants :
//   (A) colonne > MRR : abonnements SANS date de closing portés par une affaire
//       de la colonne (comptent dans la colonne, pas dans le MRR).
//   (B) MRR > colonne : abonnements AVEC date de closing portés par une affaire
//       qui n'est PAS dans la colonne SMARTLINKÉ — p.ex. affaire closée puis
//       déplacée ailleurs, date posée depuis l'onglet Abonnement, ou sous-deal
//       dont le parent n'est pas dans la colonne (comptent dans le MRR, pas
//       dans la colonne).
//   (C) dérive de dénormalisation : dealValue ≠ somme des abonnements du deal.
//
// Lecture seule — ne modifie rien.
//   DATABASE_URL="postgres://..." node scripts/diagnose-mrr-gap.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const eur = (n) => `${(n ?? 0).toFixed(2)} €`;

function isSmartlink(title) {
  return !!title && title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes('smartlink');
}

async function main() {
  // Colonnes SMARTLINKÉ (tous pipelines).
  const smartlinkCols = (await prisma.pipelineColumn.findMany({ select: { id: true, title: true } }))
    .filter((c) => isSmartlink(c.title));
  if (!smartlinkCols.length) { console.log('Aucune colonne SMARTLINKÉ trouvée.'); return; }
  const colIdSet = new Set(smartlinkCols.map((c) => c.id));

  // ---- Total de colonne (exactement le calcul du PipelineBoard) ----
  const colDeals = await prisma.deal.findMany({
    where: { columnId: { in: [...colIdSet] }, parentDealId: null },
    select: {
      id: true, dealValue: true,
      store: { select: { name: true } },
      subscriptions: { select: { value: true } },
      childDeals: { select: { id: true, dealValue: true, subscriptions: { select: { value: true } } } },
    },
  });
  const colTotal = colDeals.reduce(
    (s, d) => s + (d.dealValue || 0) + d.childDeals.reduce((c, x) => c + (x.dealValue || 0), 0),
    0,
  );

  // ---- MRR dashboard : tous les abonnements datés + leur colonne effective ----
  const datedSubs = await prisma.subscription.findMany({
    where: { closingDate: { not: null } },
    select: {
      id: true, value: true, closingDate: true, position: true,
      deal: {
        select: {
          id: true, columnId: true, parentDealId: true,
          store: { select: { name: true } },
          column: { select: { title: true } },
          parentDeal: { select: { columnId: true } },
        },
      },
    },
  });
  const mrrTotal = datedSubs.reduce((s, x) => s + (x.value || 0), 0);

  console.log('===== Rapprochement =====');
  console.log('Total colonne SMARTLINKÉ :', eur(colTotal), `(${colDeals.length} affaires)`);
  console.log('MRR total dashboard      :', eur(mrrTotal), `(${datedSubs.length} abonnements datés)`);
  console.log('Écart (colonne - MRR)    :', eur(colTotal - mrrTotal));

  // (B) MRR > colonne : abonnements datés dont l'affaire (ou son parent) n'est
  // PAS visible dans la colonne SMARTLINKÉ.
  const inSmartlinkView = (d) =>
    (d.parentDealId == null && colIdSet.has(d.columnId)) ||           // affaire dans la colonne
    (d.parentDealId != null && colIdSet.has(d.parentDeal?.columnId)); // sous-deal dont le parent est dans la colonne
  const mrrOnly = datedSubs
    .filter((s) => (s.value || 0) !== 0 && !inSmartlinkView(s.deal))
    .map((s) => ({ store: s.deal.store?.name ?? '—', col: s.deal.column?.title ?? '?', pos: s.position, value: s.value || 0 }))
    .sort((a, b) => b.value - a.value);

  console.log('\n===== (B) Abonnements DATÉS hors colonne SMARTLINKÉ  → gonflent le MRR =====');
  if (!mrrOnly.length) console.log('  Aucun.');
  else {
    for (const o of mrrOnly) console.log(`  ${eur(o.value).padStart(12)}  ·  colonne « ${o.col} »  ·  abo pos ${o.pos}  ·  ${o.store}`);
    console.log('  ----  Sous-total :', eur(mrrOnly.reduce((s, o) => s + o.value, 0)));
  }

  // (A) colonne > MRR : abonnements NON datés portés par une affaire de la colonne.
  const colView = await prisma.deal.findMany({
    where: { columnId: { in: [...colIdSet] }, parentDealId: null },
    select: {
      store: { select: { name: true } },
      subscriptions: { select: { value: true, closingDate: true, position: true } },
      childDeals: { select: { store: { select: { name: true } }, subscriptions: { select: { value: true, closingDate: true, position: true } } } },
    },
  });
  const colOnly = [];
  const pushUndated = (store, kind, subs) => {
    for (const s of subs) if (!s.closingDate && (s.value || 0) !== 0) colOnly.push({ store, kind, pos: s.position, value: s.value || 0 });
  };
  for (const d of colView) {
    pushUndated(d.store?.name ?? '—', 'affaire', d.subscriptions);
    for (const c of d.childDeals) pushUndated(c.store?.name ?? '—', 'sous-deal', c.subscriptions);
  }
  colOnly.sort((a, b) => b.value - a.value);

  console.log('\n===== (A) Abonnements NON datés dans SMARTLINKÉ  → gonflent la colonne =====');
  if (!colOnly.length) console.log('  Aucun.');
  else {
    for (const o of colOnly) console.log(`  ${eur(o.value).padStart(12)}  ·  ${o.kind} (abo pos ${o.pos})  ·  ${o.store}`);
    console.log('  ----  Sous-total :', eur(colOnly.reduce((s, o) => s + o.value, 0)));
  }

  // (C) dérive de dénormalisation : dealValue ≠ somme des abonnements.
  const drift = colDeals
    .map((d) => ({ store: d.store?.name ?? '—', dealValue: d.dealValue || 0, subs: d.subscriptions.reduce((s, x) => s + (x.value || 0), 0) }))
    .filter((d) => Math.abs(d.dealValue - d.subs) > 0.001);
  console.log('\n===== (C) Affaires SMARTLINKÉ où dealValue ≠ somme des abonnements =====');
  if (!drift.length) console.log('  Aucune — dénormalisation cohérente.');
  else for (const d of drift) console.log(`  ${d.store} : dealValue=${eur(d.dealValue)} vs abos=${eur(d.subs)} (écart ${eur(d.dealValue - d.subs)})`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
