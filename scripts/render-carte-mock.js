// Mock de mise en page de l'onglet Carte (sidebar + pastilles rondes + fond
// clair façon CARTO). Hors-ligne, pour valider la direction visuelle.
const fs = require('fs');

const BRAND = {
  'Intermarché': '#e11d48', 'Leclerc': '#2563eb', 'Super U': '#f59e0b',
  'Carrefour': '#1d4ed8', 'Aldi': '#16a34a', 'Lidl': '#ca8a04', 'Auchan': '#7c3aed',
};
// [enseigne, ville, lat, lng, statut]
const DEALS = [
  ['Intermarché', 'Nantes', 47.2184, -1.5536, 'active'],
  ['Intermarché', 'Lille', 50.6292, 3.0573, 'active'],
  ['Intermarché', 'Reims', 49.2583, 4.0317, 'lost'],
  ['Leclerc', 'Rennes', 48.1173, -1.6778, 'active'],
  ['Leclerc', 'Bordeaux', 44.8378, -0.5792, 'demo'],
  ['Leclerc', 'Toulouse', 43.6047, 1.4442, 'active'],
  ['Super U', 'Montpellier', 43.6108, 3.8767, 'active'],
  ['Super U', 'Dijon', 47.3220, 5.0415, 'active'],
  ['Super U', 'Angers', 47.4784, -0.5632, 'demo'],
  ['Carrefour', 'Lyon', 45.7640, 4.8357, 'active'],
  ['Carrefour', 'Nice', 43.7102, 7.2620, 'lost'],
  ['Carrefour', 'Grenoble', 45.1885, 5.7245, 'active'],
  ['Aldi', 'Marseille', 43.2965, 5.3698, 'active'],
  ['Aldi', 'Strasbourg', 48.5734, 7.7521, 'demo'],
  ['Aldi', 'Nîmes', 43.8367, 4.3601, 'lost'],
  ['Lidl', 'Le Havre', 49.4944, 0.1079, 'active'],
  ['Lidl', 'Clermont-Ferrand', 45.7772, 3.0870, 'active'],
  ['Auchan', 'Paris', 48.8566, 2.3522, 'active'],
  ['Auchan', 'Toulon', 43.1242, 5.9280, 'demo'],
  ['Auchan', 'Saint-Étienne', 45.4397, 4.3872, 'lost'],
];

const FRANCE = [
  [2.37, 51.03], [4.23, 49.96], [8.23, 49.0], [7.59, 47.45], [6.15, 46.2],
  [7.0, 45.0], [7.5, 43.75], [5.37, 43.29], [3.0, 42.7], [-1.79, 43.35],
  [-1.25, 44.6], [-2.2, 47.2], [-4.78, 48.39], [-1.62, 49.64], [0.1, 49.5], [2.37, 51.03],
];

const SBW = 300, W = 1320, H = 820;
const MX0 = SBW, MW = W - SBW;
const kx = Math.cos((46.7 * Math.PI) / 180);
const project = ([lng, lat]) => [lng * kx, -lat];
const pts = [...FRANCE.map(project), ...DEALS.map(([, , lat, lng]) => project([lng, lat]))];
const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
const PAD = 70;
const s = Math.min((MW - 2 * PAD) / (maxX - minX), (H - 2 * PAD) / (maxY - minY));
const ox = MX0 + PAD + ((MW - 2 * PAD) - s * (maxX - minX)) / 2;
const oy = PAD + ((H - 2 * PAD) - s * (maxY - minY)) / 2;
const toXY = (lng, lat) => { const [px, py] = project([lng, lat]); return [ox + (px - minX) * s, oy + (py - minY) * s]; };

function dot(x, y, color, status, r = 7) {
  if (status === 'lost') return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="${color}" stroke-width="3" opacity="0.92"/>`;
  if (status === 'demo') return `<circle cx="${x}" cy="${y}" r="${r + 1.5}" fill="none" stroke="#16a34a" stroke-width="2.5"/><circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="#fff" stroke-width="2"/>`;
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="#fff" stroke-width="2"/>`;
}

const outline = FRANCE.map(([lng, lat], i) => { const [x, y] = toXY(lng, lat); return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1); }).join(' ') + ' Z';
const markers = DEALS.map(([brand, , lat, lng, st]) => { const [x, y] = toXY(lng, lat); return dot(x, y, BRAND[brand], st); }).join('\n');

// Légende enseignes (wrap)
const brandNames = Object.keys(BRAND);
let lx = 0, ly = 0;
const brandLegend = brandNames.map((n) => {
  const w = 12 + n.length * 6.7 + 16;
  if (lx + w > SBW - 32) { lx = 0; ly += 22; }
  const g = `<g transform="translate(${16 + lx},${ly})"><circle cx="6" cy="6" r="6" fill="${BRAND[n]}"/><text x="17" y="10" font-size="12" fill="#475569">${n}</text></g>`;
  lx += w; return g;
}).join('');
const legendH = ly + 22;

// Liste (9 premières)
const rows = DEALS.slice(0, 9).map(([brand, city, , , st], i) => `
  <g transform="translate(0,${i * 46})">
    ${i > 0 ? `<line x1="16" y1="0" x2="${SBW}" y2="0" stroke="#f1f5f9"/>` : ''}
    ${dot(28, 23, BRAND[brand], st, 7)}
    <text x="46" y="20" font-size="13" font-weight="600" fill="#0f172a">${brand}</text>
    <text x="46" y="36" font-size="11.5" fill="#94a3b8">${city}</text>
  </g>`).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <rect width="100%" height="100%" fill="#f5f6f4"/>
  <!-- carte -->
  <rect x="${MX0}" y="0" width="${MW}" height="${H}" fill="#f3f4f1"/>
  <path d="${outline}" fill="#fbfcfa" stroke="#d4dae0" stroke-width="1.2"/>
  ${markers}
  <!-- zoom control -->
  <g transform="translate(${W - 52},20)">
    <rect x="0" y="0" width="32" height="32" rx="6" fill="#fff" stroke="#e2e8f0"/><text x="16" y="22" font-size="20" text-anchor="middle" fill="#334155">+</text>
    <rect x="0" y="34" width="32" height="32" rx="6" fill="#fff" stroke="#e2e8f0"/><text x="16" y="56" font-size="20" text-anchor="middle" fill="#334155">−</text>
  </g>
  <text x="${W - 8}" y="${H - 8}" font-size="10" text-anchor="end" fill="#94a3b8">Leaflet · © OpenStreetMap © CARTO</text>

  <!-- sidebar -->
  <rect x="0" y="0" width="${SBW}" height="${H}" fill="#ffffff"/>
  <line x1="${SBW}" y1="0" x2="${SBW}" y2="${H}" stroke="#e2e8f0"/>
  <circle cx="24" cy="30" r="5" fill="#e11d48"/>
  <text x="36" y="36" font-size="19" font-weight="700" fill="#0f172a">Carte des deals</text>
  <text x="16" y="58" font-size="12.5" fill="#64748b">Pipeline « Prospection »</text>

  <!-- search -->
  <rect x="16" y="72" width="${SBW - 32}" height="38" rx="10" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="30" y="96" font-size="13" fill="#94a3b8">🔍</text>
  <text x="48" y="96" font-size="13" fill="#94a3b8">Rechercher une enseigne ou une ville…</text>

  <!-- compteur + actualiser -->
  <text x="16" y="134" font-size="13"><tspan fill="#e11d48" font-weight="700">20</tspan><tspan fill="#64748b"> deals</tspan></text>
  <text x="${SBW - 16}" y="134" font-size="12.5" text-anchor="end" fill="#64748b">↻ Actualiser</text>

  <!-- legende enseignes -->
  <g transform="translate(0,146)">${brandLegend}</g>
  <line x1="0" y1="${146 + legendH + 4}" x2="${SBW}" y2="${146 + legendH + 4}" stroke="#f1f5f9"/>

  <!-- liste -->
  <g transform="translate(0,${146 + legendH + 16})">${rows}</g>

  <!-- legende etats (bas) -->
  <line x1="0" y1="${H - 92}" x2="${SBW}" y2="${H - 92}" stroke="#e2e8f0"/>
  <g transform="translate(16,${H - 74})" font-size="11.5" fill="#475569">
    <g>${dot(7, 7, '#64748b', 'active', 6)}<text x="22" y="11">En cours</text></g>
    <g transform="translate(0,24)">${dot(7, 7, '#64748b', 'demo', 6)}<text x="22" y="11">Démo prévue (anneau vert)</text></g>
    <g transform="translate(0,48)">${dot(7, 7, '#64748b', 'lost', 6)}<text x="22" y="11">Pas intéressé (creux)</text></g>
  </g>
</svg>`;

fs.writeFileSync('/tmp/carte-mock.svg', svg);
const { Resvg } = require('@resvg/resvg-js');
fs.writeFileSync('/tmp/carte-mock.png', new Resvg(svg, { fitTo: { mode: 'width', value: 1600 } }).render().asPng());
console.log('Mock écrit:', fs.statSync('/tmp/carte-mock.png').size, 'octets');
