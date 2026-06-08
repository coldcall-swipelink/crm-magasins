// scripts/seed-carte.ts
// Jeu de données fictif pour tester l'onglet Carte SANS dépendre de l'API de
// géocodage : on renseigne directement latitude/longitude (+ geocodeQuery
// identique à celui que construirait l'API, pour qu'aucun appel réseau ne soit
// tenté). Couvre plusieurs enseignes et toutes les colonnes, dont « Pas
// intéressé » (épingle foncée) et « Démo prévue » (contour vert).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const COLUMNS = [
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
  { name: 'Lidl',        color: '#ca8a04' },
  { name: 'Auchan',      color: '#7c3aed' },
];

// [enseigne, ville, CP, adresse, lat, lng, colonne]
const DEALS: Array<[string, string, string, string, number, number, string]> = [
  ['Intermarché', 'Nantes',            '44000', '12 rue de la Paix',        47.2184, -1.5536, 'Contacté'],
  ['Intermarché', 'Lille',             '59000', '3 av de la République',    50.6292,  3.0573, 'À appeler'],
  ['Intermarché', 'Reims',             '51100', '8 rue de Vesle',           49.2583,  4.0317, 'Pas intéressé'],
  ['Leclerc',     'Rennes',            '35000', '45 av de Bretagne',        48.1173, -1.6778, 'Email envoyé'],
  ['Leclerc',     'Bordeaux',          '33000', '2 cours de l\'Intendance', 44.8378, -0.5792, 'Démo prévue'],
  ['Leclerc',     'Toulouse',          '31000', '10 allées Jean Jaurès',    43.6047,  1.4442, 'Intéressé'],
  ['Super U',     'Montpellier',       '34000', '5 rue Foch',               43.6108,  3.8767, 'À appeler'],
  ['Super U',     'Dijon',             '21000', '14 rue de la Liberté',     47.3220,  5.0415, 'Relance prévue'],
  ['Super U',     'Angers',            '49000', '7 rue Saint-Aubin',        47.4784, -0.5632, 'Démo prévue'],
  ['Carrefour',   'Lyon',              '69007', '22 rue Garibaldi',         45.7640,  4.8357, 'Intéressé'],
  ['Carrefour',   'Nice',              '06000', '18 av Jean Médecin',       43.7102,  7.2620, 'Pas intéressé'],
  ['Carrefour',   'Grenoble',          '38000', '3 rue Félix Poulat',       45.1885,  5.7245, 'Contacté'],
  ['Aldi',        'Marseille',         '13001', '5 rue Paradis',            43.2965,  5.3698, 'Relance prévue'],
  ['Aldi',        'Strasbourg',        '67000', '9 rue du Dôme',            48.5734,  7.7521, 'Démo prévue'],
  ['Aldi',        'Nîmes',             '30000', '4 bd Victor Hugo',         43.8367,  4.3601, 'Pas intéressé'],
  ['Lidl',        'Le Havre',          '76600', '11 rue de Paris',          49.4944,  0.1079, 'À appeler'],
  ['Lidl',        'Clermont-Ferrand',  '63000', '6 rue Blatin',             45.7772,  3.0870, 'Email envoyé'],
  ['Auchan',      'Paris',             '75011', '30 bd Voltaire',           48.8566,  2.3522, 'Intéressé'],
  ['Auchan',      'Toulon',            '83000', '2 av de la République',    43.1242,  5.9280, 'Démo prévue'],
  ['Auchan',      'Saint-Étienne',     '42000', '8 rue Gambetta',           45.4397,  4.3872, 'Pas intéressé'],
];

function normalize(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function main() {
  console.log('🌱 Seed Carte (données fictives géolocalisées)…');

  const pipeline = await prisma.pipeline.upsert({
    where: { name: 'Prospection' },
    update: {},
    create: { name: 'Prospection', position: 0, color: '#6366f1' },
  });

  const cols: Record<string, string> = {};
  for (const c of COLUMNS) {
    const existing = await prisma.pipelineColumn.findFirst({ where: { pipelineId: pipeline.id, title: c.title } });
    const created = existing ?? await prisma.pipelineColumn.create({
      data: { pipelineId: pipeline.id, title: c.title, position: c.position, color: c.color, isDefault: c.isDefault },
    });
    cols[c.title] = created.id;
  }

  const brands: Record<string, string> = {};
  for (const b of BRANDS) {
    const created = await prisma.brand.upsert({ where: { name: b.name }, update: { color: b.color }, create: b });
    brands[b.name] = created.id;
  }

  let i = 0;
  for (const [brand, city, cp, address, lat, lng, col] of DEALS) {
    const name = `${brand} ${city}`;
    const dedupKey = `seed-carte:${normalize(name)}`;
    const geocodeQuery = [address, cp, city].filter(Boolean).join(' ');

    const store = await prisma.store.upsert({
      where: { deduplicationKey: dedupKey },
      update: { latitude: lat, longitude: lng, geocodeQuery, geocodedAt: new Date() },
      create: {
        brandId: brands[brand],
        name,
        normalizedName: normalize(name),
        city, postalCode: cp, address,
        latitude: lat, longitude: lng, geocodeQuery, geocodedAt: new Date(),
        deduplicationKey: dedupKey,
      },
    });

    await prisma.deal.upsert({
      where: { storeId: store.id },
      update: { columnId: cols[col] },
      create: {
        pipelineId: pipeline.id,
        storeId: store.id,
        columnId: cols[col],
        priority: 'normale',
        position: i,
        isPresentInLastImport: true,
      },
    });
    i++;
  }

  console.log(`✅ ${DEALS.length} deals fictifs créés sur le pipeline Prospection.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
