// Génère un aperçu SVG de l'onglet Carte à partir des données réelles de
// /api/map, en réutilisant la logique de couleur des épingles de l'app.
// Hors-ligne : aucune tuile, aucune dépendance réseau.
const fs = require('fs');

const data = JSON.parse(fs.readFileSync('/tmp/map.json', 'utf8'));
const deals = data.deals;

const DEFAULT_COLOR = '#64748b';
function darkenHex(hex, amount = 0.4) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const f = Math.max(0, Math.min(1, 1 - amount));
  const r = Math.round(((num >> 16) & 255) * f);
  const g = Math.round(((num >> 8) & 255) * f);
  const b = Math.round((num & 255) * f);
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}
function fillColorFor(d) {
  const base = d.brandColor || DEFAULT_COLOR;
  return d.columnTitle === 'Pas intéressé' ? darkenHex(base, 0.4) : base;
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
const sx = (W - 2 * PAD) / (maxX - minX);
const sy = (H - 2 * PAD) / (maxY - minY);
const s = Math.min(sx, sy);
const ox = PAD + ((W - 2 * PAD) - s * (maxX - minX)) / 2;
const oy = PAD + ((H - 2 * PAD) - s * (maxY - minY)) / 2;
const toXY = (lng, lat) => {
  const [px, py] = project([lng, lat]);
  return [ox + (px - minX) * s, oy + (py - minY) * s];
};

function pin(x, y, fill, isDemo) {
  const stroke = isDemo ? '#16a34a' : '#ffffff';
  const sw = isDemo ? 3 : 1.5;
  const sc = 0.85; // échelle de l'épingle
  return `<g transform="translate(${x - 14 * sc},${y - 39 * sc}) scale(${sc})">
    <path d="M14 1C7.1 1 1.5 6.6 1.5 13.5C1.5 22.5 14 39 14 39C14 39 26.5 22.5 26.5 13.5C26.5 6.6 20.9 1 14 1Z"
          fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
    <circle cx="14" cy="13.5" r="4.5" fill="#ffffff" fill-opacity="0.92"/>
  </g>`;
}

const outline = FRANCE.map(([lng, lat], i) => {
  const [x, y] = toXY(lng, lat);
  return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
}).join(' ') + ' Z';

const pins = deals.map((d) => {
  const [x, y] = toXY(d.longitude, d.latitude);
  return pin(x, y, fillColorFor(d), d.columnTitle === 'Démo prévue');
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

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W + 220}" height="${H}" viewBox="0 0 ${W + 220} ${H}" font-family="-apple-system,Segoe UI,Roboto,sans-serif">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${PAD}" y="36" font-size="20" font-weight="700" fill="#0f172a">🗺️ Carte des deals — pipeline « Prospection »</text>
  <text x="${PAD}" y="56" font-size="13" fill="#64748b">${deals.length} deals localisés · aperçu généré depuis /api/map (données fictives)</text>
  <rect x="20" y="70" width="${W - 40 + 20}" height="${H - 90}" rx="14" fill="#eaf1f7" stroke="#dbe4ec"/>
  <path d="${outline}" fill="#f8fbfe" stroke="#9fb6c6" stroke-width="1.5"/>
  ${pins}
  <g transform="translate(${W + 20},90)">
    <text x="0" y="0" font-size="11" font-weight="700" fill="#94a3b8" letter-spacing="0.8">ENSEIGNES</text>
    <g transform="translate(0,16)">${legend}</g>
    <g transform="translate(0,${16 + brands.length * 22 + 18})">
      <text x="0" y="0" font-size="11" font-weight="700" fill="#94a3b8" letter-spacing="0.8">ÉTAPES</text>
      <g transform="translate(0,16)">
        <circle cx="8" cy="8" r="7" fill="${darkenHex('#2563eb', 0.4)}"/>
        <text x="22" y="12" font-size="12" fill="#475569">« Pas intéressé » → foncé</text>
      </g>
      <g transform="translate(0,40)">
        <circle cx="8" cy="8" r="7" fill="#2563eb" stroke="#16a34a" stroke-width="3"/>
        <text x="22" y="12" font-size="12" fill="#475569">« Démo prévue » → contour vert</text>
      </g>
    </g>
  </g>
</svg>`;

fs.writeFileSync('/tmp/carte-preview.svg', svg);
console.log('SVG écrit. Deals:', deals.length, '· Démo prévue:', deals.filter(d=>d.columnTitle==='Démo prévue').length, '· Pas intéressé:', deals.filter(d=>d.columnTitle==='Pas intéressé').length);
