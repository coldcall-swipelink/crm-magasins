/**
 * Génère toutes les icônes de public/ à partir des sources vectorielles
 * scripts/logo/logo.html (logo complet) et logo-compact.html (le S seul).
 *
 *   npx playwright install chromium   # une seule fois
 *   node scripts/logo/generate-icons.js
 *
 * Le rendu passe par Chromium (Playwright) : le logo est décrit en HTML/CSS/SVG,
 * ce qui garde le dégradé conique du cadre et le tracé du S nets à toute taille.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const HERE = __dirname;
const PUBLIC = path.resolve(HERE, '../../public');

// [source, fichier de sortie, taille px, marge (ratio), fond ('none' = transparent)]
const TARGETS = [
  ['logo.html',         'logo.png',              512, 0,    'none'],
  ['logo-compact.html', 'logo-mark.png',         256, 0,    'none'],
  ['logo.html',         'icon-192.png',          192, 0,    '#ffffff'],
  ['logo.html',         'icon-512.png',          512, 0,    '#ffffff'],
  ['logo.html',         'icon-maskable-512.png', 512, 0.11, '#ffffff'],
  // iOS masque l'icône en « squircle » : la marge évite de rogner le cadre.
  ['logo.html',         'apple-touch-icon.png',  180, 0.06, '#ffffff'],
  ['logo-compact.html', 'favicon-16.png',         16, 0,    'none'],
  ['logo-compact.html', 'favicon-32.png',         32, 0,    'none'],
  ['logo-compact.html', 'favicon-48.png',         48, 0,    'none'],
];

const ICO_SOURCES = ['favicon-16.png', 'favicon-32.png', 'favicon-48.png'];

async function render(browser, src, out, size, pad, bg) {
  const margin = Math.round(size * pad);
  const inner = size - 2 * margin;
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(HERE, src));
  await page.addStyleTag({ content: `
    html,body{width:${size}px;height:${size}px;overflow:hidden;${bg !== 'none' ? `background:${bg};` : ''}}
    .frame{transform-origin:0 0;transform:translate(${margin}px,${margin}px) scale(${inner / 1024});}` });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(PUBLIC, out), omitBackground: bg === 'none' });
  await page.close();
}

// ICO « moderne » : chaque image est un PNG embarqué tel quel.
function buildIco(sources) {
  const imgs = sources.map(f => ({
    size: parseInt(f.match(/(\d+)\.png$/)[1], 10),
    buf: fs.readFileSync(path.join(PUBLIC, f)),
  }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(imgs.length, 4);
  const dir = Buffer.alloc(16 * imgs.length);
  let offset = header.length + dir.length;
  imgs.forEach((img, i) => {
    const o = i * 16;
    dir.writeUInt8(img.size === 256 ? 0 : img.size, o);
    dir.writeUInt8(img.size === 256 ? 0 : img.size, o + 1);
    dir.writeUInt16LE(1, o + 4);   // plans
    dir.writeUInt16LE(32, o + 6);  // bits par pixel
    dir.writeUInt32LE(img.buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += img.buf.length;
  });
  fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), Buffer.concat([header, dir, ...imgs.map(i => i.buf)]));
}

(async () => {
  const browser = await chromium.launch();
  for (const [src, out, size, pad, bg] of TARGETS) {
    await render(browser, src, out, size, pad, bg);
    console.log('✓', out);
  }
  await browser.close();
  buildIco(ICO_SOURCES);
  console.log('✓ favicon.ico');
})();
