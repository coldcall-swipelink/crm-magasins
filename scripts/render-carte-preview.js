// Génère un aperçu SVG de l'onglet Carte à partir des données réelles de
// /api/map, en réutilisant la logique d'épingle de l'app (forme goutte affinée
// + icône d'état : point coloré / ✓ vert / croix rouge).
// Hors-ligne : aucune tuile, aucune dépendance réseau.
const fs = require('fs');

const data = JSON.parse(fs.readFileSync('/tmp/map.json', 'utf8'));
const deals = data.deals;

const DEFAULT_COLOR = '#64748b';

function statusOf(title) {
  const t = (title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (t === 'demo prevue') return 'demo';
  if (t === 'pas interesse') return 'lost';
  return 'active';
}

// Contour approximatif de la France métropolitaine (lng, lat).
const FRANCE = [
  [2.37, 51.03], [4.23, 49.96], [8.23, 49.0], [7.59, 47.45], [6.15, 46.2],
  [7.0, 45.0], [7.5, 43.75], [5.37, 43.29], [3.0, 42.7], [-1.79, 43.35],
  [-1.25, 44.6], [-2.2, 47.2], [-4.78, 48.39], [-1.62, 49.64], [0.1, 49.5], [2.37, 51.03],
];

const latMid = 46.7;
const kx = Math.cos((latMid * Math.PI) / 180);
const project = ([lng, lat]) => [lng * kx, -lat];

const all = [...FRANCE.map(project), ...deals.map((d) => project([d.longitude, d.latitude]))];
const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);

const PAD = 60, W = 720, H = 760;
const s = Math.min((W - 2 * PAD) / (maxX - minX), (H - 2 * PAD) / (maxY - minY));
const ox = PAD + ((W - 2 * PAD) - s * (maxX - minX)) / 2;
const oy = PAD + ((H - 2 * PAD) - s * (maxY - minY)) / 2;
const toXY = (lng, lat) => {
  const [px, py] = project([lng, lat]);
  return [ox + (px - minX) * s, oy + (py - minY) * s];
};

function glyphFor(status, fill) {
  if (status === 'demo') return `<path d="M10.6 13 l2.2 2.2 l4.6 -4.8" fill="none" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (status === 'lost') return `<path d="M11.2 10.2 L16.8 15.8 M16.8 10.2 L11.2 15.8" stroke="#dc2626" stroke-width="2.2" stroke-linecap="round"/>`;
  return `<circle cx="14" cy="13" r="2.7" fill="${fill}"/>`;
}

function pin(x, y, fill, status) {
  const sc = 0.95;
  return `<g transform="translate(${x - 14 * sc},${y - 38 * sc}) scale(${sc})">
    <path d="M14 2 C8.5 2 4 6.5 4 12 C4 19.5 14 38 14 38 C14 38 24 19.5 24 12 C24 6.5 19.5 2 14 2 Z" fill="${fill}" stroke="#ffffff" stroke-width="1.5"/>
    <circle cx="14" cy="13" r="6.2" fill="#ffffff"/>
    ${glyphFor(status, fill)}
  </g>`;
}

const outline = FRANCE.map(([lng, lat], i) => {
  const [x, y] = toXY(lng, lat);
  return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
}).join(' ') + ' Z';

const pins = deals.map((d) => {
  const [x, y] = toXY(d.longitude, d.latitude);
  return pin(x, y, d.brandColor || DEFAULT_COLOR, statusOf(d.columnTitle));
}).join('\n');

// Légende enseignes
const brands = [];
const seen = new Set();
for (const d of deals) {
  const name = d.brandName || 'Sans enseigne';
  if (!seen.has(name)) { seen.add(name); brands.push({ name, color: d.brandColor || DEFAULT_COLOR }); }
}
const legend = brands.map((b, i) => `
  <g transform="translate(0,${i * 22})">
    <circle cx="8" cy="8" r="7" fill="${b.color}"/>
    <text x="22" y="12" font-size="13" fill="#334155">${b.name}</text>
  </g>`).join('');

// Pastille de légende état (reprend la tête de l'épingle)
function badge(status) {
  return `<circle cx="9" cy="9" r="8.5" fill="#6366f1"/><circle cx="9" cy="9" r="5.2" fill="#fff"/>` +
    glyphFor(status, '#6366f1').replace(/cx="14" cy="13" r="2.7"/, 'cx="9" cy="9" r="2.1"')
      .replace('M10.6 13 l2.2 2.2 l4.6 -4.8', 'M6.2 9 l1.7 1.7 l3.6 -3.8')
      .replace('M11.2 10.2 L16.8 15.8 M16.8 10.2 L11.2 15.8', 'M6.8 6.8 L11.2 11.2 M11.2 6.8 L6.8 11.2')
      .replace(/stroke-width="2.2"/g, 'stroke-width="1.8"');
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W + 230}" height="${H}" viewBox="0 0 ${W + 230} ${H}" font-family="-apple-system,Segoe UI,Roboto,sans-serif">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${PAD}" y="36" font-size="20" font-weight="700" fill="#0f172a">Carte des deals — pipeline « Prospection »</text>
  <text x="${PAD}" y="56" font-size="13" fill="#64748b">${deals.length} deals localisés · aperçu généré depuis /api/map (données fictives)</text>
  <rect x="20" y="70" width="${W}" height="${H - 90}" rx="14" fill="#eaf1f7" stroke="#dbe4ec"/>
  <path d="${outline}" fill="#f8fbfe" stroke="#9fb6c6" stroke-width="1.5"/>
  ${pins}
  <g transform="translate(${W + 30},90)">
    <text x="0" y="0" font-size="11" font-weight="700" fill="#94a3b8" letter-spacing="0.8">ENSEIGNES</text>
    <g transform="translate(0,16)">${legend}</g>
    <g transform="translate(0,${16 + brands.length * 22 + 18})">
      <text x="0" y="0" font-size="11" font-weight="700" fill="#94a3b8" letter-spacing="0.8">ÉTAPES</text>
      <g transform="translate(0,14)"><g transform="translate(0,0)">${badge('active')}</g><text x="26" y="13" font-size="12" fill="#475569">En cours — point</text></g>
      <g transform="translate(0,40)"><g transform="translate(0,0)">${badge('demo')}</g><text x="26" y="13" font-size="12" fill="#475569">Démo prévue — coche verte</text></g>
      <g transform="translate(0,66)"><g transform="translate(0,0)">${badge('lost')}</g><text x="26" y="13" font-size="12" fill="#475569">Pas intéressé — croix rouge</text></g>
    </g>
  </g>
</svg>`;

fs.writeFileSync('/tmp/carte-preview.svg', svg);
console.log('SVG écrit. Deals:', deals.length,
  '· active:', deals.filter((d) => statusOf(d.columnTitle) === 'active').length,
  '· demo:', deals.filter((d) => statusOf(d.columnTitle) === 'demo').length,
  '· lost:', deals.filter((d) => statusOf(d.columnTitle) === 'lost').length);
