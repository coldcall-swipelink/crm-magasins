// prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_COLUMNS = [
  { title: 'À appeler',      position: 0, color: '#6366f1', isDefault: true  },
  { title: 'Contacté',       position: 1, color: '#8b5cf6', isDefault: false },
  { title: 'Email envoyé',   position: 2, color: '#0ea5e9', isDefault: false },
  { title: 'Relance prévue', position: 3, color: '#f59e0b', isDefault: false },
  { title: 'Intéressé',      position: 4, color: '#22c55e', isDefault: false },
  { title: 'Démo prévue',    position: 5, color: '#10b981', isDefault: false },
  { title: 'Client',         position: 6, color: '#84cc16', isDefault: false },
  { title: 'Pas intéressé',  position: 7, color: '#64748b', isDefault: false },
];

const BRANDS = [
  { name: 'Intermarché', color: '#e11d48' },
  { name: 'Leclerc',     color: '#2563eb' },
  { name: 'Super U',     color: '#f59e0b' },
  { name: 'Carrefour',   color: '#1d4ed8' },
  { name: 'Aldi',        color: '#16a34a' },
];

async function main() {
  console.log('🌱 Seeding database…');

  // 0. Pipeline
  console.log('  → Création du pipeline Prospection');
  const pipeline = await prisma.pipeline.upsert({
    where: { name: 'Prospection' },
    update: {},
    create: {
      name: 'Prospection',
      order: 0,
      color: '#6366f1',
    },
  });

  // 1. Colonnes pipeline
  console.log('  → Création des colonnes pipeline');
  const columns: Record<string, string> = {};
  for (const col of DEFAULT_COLUMNS) {
    const created = await prisma.pipelineColumn.create({
      data: {
        pipelineId: pipeline.id,
        title: col.title,
        position: col.position,
        color: col.color,
        isDefault: col.isDefault,
      },
    });
    columns[col.title] = created.id;
  }

  // 2. Enseignes
  console.log('  → Création des enseignes');
  const brands: Record<string, string> = {};
  for (const brand of BRANDS) {
    const created = await prisma.brand.upsert({
      where: { name: brand.name },
      update: { color: brand.color },
      create: brand,
    });
    brands[brand.name] = created.id;
  }

  // 3. Import batch exemple
  console.log('  → Création d\'un import exemple');
  const batch = await prisma.importBatch.create({
    data: {
      fileName: 'seed-initial.csv',
      totalRows: 6,
      createdDeals: 6,
      updatedDeals: 0,
      newOffers: 8,
      movedToCall: 0,
      disappearedOffers: 0,
      errorCount: 0,
    },
  });

  // 4. Magasins et affaires de démonstration
  console.log('  → Création des affaires de démonstration');

  const demoDeals = [
    {
      store: { name: 'Intermarché Nantes Sud', city: 'Nantes', department: '44', address: '12 rue de la Paix', brandName: 'Intermarché', dedupKey: 'k:intermarche|nantes|intermarche nantes sud' },
      column: 'Contacté',
      priority: 'élevée',
      offers: [
        { title: 'Boucher H/F CDI', jobTitle: 'Boucher', contractType: 'CDI', salary: '2200€/mois', source: 'Indeed', url: 'https://fr.indeed.com/jobs?q=boucher', publishedAt: '2025-01-10' },
        { title: 'Resp. Boucherie H/F', jobTitle: 'Responsable Boucherie', contractType: 'CDI', salary: '3000€/mois', source: 'Indeed', url: 'https://fr.indeed.com/jobs?q=responsable-boucherie', publishedAt: '2025-01-10' },
      ],
    },
    {
      store: { name: 'E.Leclerc Rennes', city: 'Rennes', department: '35', address: '45 av de Bretagne', brandName: 'Leclerc', dedupKey: 'k:leclerc|rennes|e.leclerc rennes' },
      column: 'Email envoyé',
      priority: 'normale',
      offers: [
        { title: 'Responsable rayon frais H/F', jobTitle: 'Manager Rayon', contractType: 'CDI', salary: '2800€/mois', source: 'Indeed', url: 'https://fr.indeed.com/jobs?q=manager-rayon', publishedAt: '2025-01-11' },
      ],
    },
    {
      store: { name: 'Super U Bordeaux', city: 'Bordeaux', department: '33', address: '8 bd des Capucins', brandName: 'Super U', dedupKey: 'k:super u|bordeaux|super u bordeaux' },
      column: 'À appeler',
      priority: 'normale',
      offers: [
        { title: 'Caissier H/F temps partiel', jobTitle: 'Caissier', contractType: 'CDD', salary: '1600€/mois', source: 'Pole Emploi', url: '', publishedAt: '2025-01-12' },
      ],
    },
    {
      store: { name: 'Carrefour Market Lyon 7', city: 'Lyon', department: '69', address: '22 rue Garibaldi', brandName: 'Carrefour', dedupKey: 'k:carrefour|lyon|carrefour market lyon 7' },
      column: 'Intéressé',
      priority: 'élevée',
      offers: [
        { title: 'Employé polyvalent H/F', jobTitle: 'Employé libre service', contractType: 'CDI', salary: '1700€/mois', source: 'Hellowork', url: '', publishedAt: '2025-01-13' },
        { title: 'Chef de caisse H/F', jobTitle: 'Chef de caisse', contractType: 'CDI', salary: '2100€/mois', source: 'Hellowork', url: '', publishedAt: '2025-01-14' },
      ],
    },
    {
      store: { name: 'Aldi Marseille Centre', city: 'Marseille', department: '13', address: '5 rue Paradis', brandName: 'Aldi', dedupKey: 'k:aldi|marseille|aldi marseille centre' },
      column: 'Relance prévue',
      priority: 'faible',
      offers: [
        { title: 'Employé commercial H/F', jobTitle: 'Employé commercial', contractType: 'CDI', salary: '1800€/mois', source: 'Hellowork', url: '', publishedAt: '2025-02-01' },
      ],
    },
    {
      store: { name: 'Intermarché Lille Nord', city: 'Lille', department: '59', address: '3 av de la République', brandName: 'Intermarché', dedupKey: 'k:intermarche|lille|intermarche lille nord' },
      column: 'À appeler',
      priority: 'urgente',
      offers: [
        { title: 'Directeur de magasin H/F', jobTitle: 'Directeur', contractType: 'CDI', salary: '4500€/mois', source: 'Indeed', url: '', publishedAt: '2025-02-01' },
      ],
    },
  ];

  for (let i = 0; i < demoDeals.length; i++) {
    const { store: storeData, column, priority, offers } = demoDeals[i];
    const colId = columns[column] || columns['À appeler'];

    // Store
    const store = await prisma.store.upsert({
      where: { deduplicationKey: storeData.dedupKey },
      update: {},
      create: {
        brandId: brands[storeData.brandName] || null,
        name: storeData.name,
        normalizedName: storeData.name.toLowerCase(),
        city: storeData.city,
        department: storeData.department,
        address: storeData.address,
        deduplicationKey: storeData.dedupKey,
      },
    });

    // Deal
    const deal = await prisma.deal.upsert({
      where: { storeId: store.id },
      update: {},
      create: {
        storeId: store.id,
        columnId: colId,
        priority,
        position: i,
        isNewFromLastImport: false,
        hasNewOfferFromLastImport: false,
        isPresentInLastImport: true,
        lastImportAt: new Date(),
      },
    });

    // Offres
    for (const offer of offers) {
      const fp = `seed-${store.id}-${offer.jobTitle}`.replace(/\s+/g, '-').toLowerCase();
      await prisma.jobOffer.upsert({
        where: { fingerprint: fp },
        update: {},
        create: {
          dealId: deal.id,
          storeId: store.id,
          importBatchId: batch.id,
          title: offer.title,
          jobTitle: offer.jobTitle,
          contractType: offer.contractType,
          salary: offer.salary,
          source: offer.source,
          url: offer.url,
          publishedAt: offer.publishedAt,
          fingerprint: fp,
          status: 'active',
        },
      });
    }

    // Import row
    await prisma.importRow.create({
      data: {
        importBatchId: batch.id,
        rowNumber: i + 1,
        rawData: { store: storeData.name },
        status: 'ok',
        storeId: store.id,
        dealId: deal.id,
      },
    });
  }

  // 5. Actions de démonstration
  console.log('  → Création des actions exemple');
  const deals = await prisma.deal.findMany({ take: 3 });
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);

  if (deals[0]) {
    await prisma.action.create({ data: { dealId: deals[0].id, title: 'Appeler le responsable RH', type: 'Appeler', dueDate: yesterday, status: 'todo', priority: 'élevée', note: 'Demander à parler à M. Dupont' } });
  }
  if (deals[1]) {
    await prisma.action.create({ data: { dealId: deals[1].id, title: 'Envoyer la plaquette commerciale', type: 'Email', dueDate: tomorrow, status: 'todo', priority: 'normale' } });
    await prisma.action.create({ data: { dealId: deals[1].id, title: 'Relancer si pas de réponse', type: 'Relancer', dueDate: nextWeek, status: 'todo', priority: 'faible' } });
  }
  if (deals[2]) {
    await prisma.action.create({ data: { dealId: deals[2].id, title: 'Premier contact téléphonique', type: 'Appeler', dueDate: new Date(), status: 'todo', priority: 'normale', note: 'Appeler en matinée' } });
  }

  console.log('✅ Seed terminé avec succès !');
  console.log(`   - 1 pipeline (Prospection)`);
  console.log(`   - ${DEFAULT_COLUMNS.length} colonnes pipeline`);
  console.log(`   - ${BRANDS.length} enseignes`);
  console.log(`   - ${demoDeals.length} affaires avec offres`);
  console.log('   - 4 actions de rappel');
}

main()
  .catch((e) => { console.error('❌ Erreur seed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
