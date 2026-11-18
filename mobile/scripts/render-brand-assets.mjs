#!/usr/bin/env node
/**
 * Renders the app icon / splash PNGs from the logo mark (direction A, canvas v2 `LogoIkon.dc.html`).
 *
 *   node scripts/render-brand-assets.mjs
 *
 * Needs a local Chrome/Chromium (headless screenshot of generated SVGs; no npm dependency).
 * Set CHROME_PATH to override the binary. SVG sources are written to assets/brand/ and kept in git,
 * so the PNGs can also be re-exported with any other SVG tool.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INK = '#1C1A17';
const CREAM = '#F4F1EC';
const WHITE = '#FFFFFF';

const DROP = 'M26 6C26 6 10 24 10 36a16 16 0 0 0 32 0C42 24 26 6 26 6z';
const HOOK = 'M23.4 27a2.7 2.7 0 1 1 3.8 2.5c-.8.3-1.2.9-1.2 1.7v1.5M26 32.7 15.8 40.6h20.4z';
const BASE = 'M26 32.7 15.8 40.6h20.4z';

/** The mark, `height` px tall, centred in a `size`×`size` canvas (mark box is 36:50 — the whole drop). */
function mark({ size, height, drop, hook, hookPath = HOOK, strokeWidth = 2.2, cutOut = false, canvasHeight = size }) {
  const width = (height * 36) / 50;
  const x = (size - width) / 2;
  const y = (canvasHeight - height) / 2;
  const stroke = `fill="none" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"`;
  if (cutOut) {
    // Monochrome layer: the hook is transparent (alpha is the only channel Android uses).
    return `<defs><mask id="m" maskUnits="userSpaceOnUse" x="8" y="4" width="36" height="50"><rect x="8" y="4" width="36" height="50" fill="#fff"/><path d="${hookPath}" ${stroke} stroke="#000"/></mask></defs>
  <svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="8 4 36 50"><path d="${DROP}" fill="${drop}" mask="url(#m)"/></svg>`;
  }
  return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="8 4 36 50"><path d="${DROP}" fill="${drop}"/><path d="${hookPath}" ${stroke} stroke="${hook}"/></svg>`;
}

function svg(width, height, body, background) {
  const bg = background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bg}\n  ${body}\n</svg>\n`;
}

/** name → { png (relative to assets/), width, height, svg } */
const assets = {
  // iOS / store icon: cream drop on ink, mark = 62 % of the tile height. Full bleed; the OS masks it.
  icon: { png: 'images/icon.png', w: 1024, h: 1024, svg: svg(1024, 1024, mark({ size: 1024, height: 636, drop: CREAM, hook: INK }), INK) },
  // Android adaptive: 108 dp canvas, 66 dp safe zone; the mark is 42 dp tall.
  'android-foreground': {
    png: 'images/android-icon-foreground.png',
    w: 512,
    h: 512,
    svg: svg(512, 512, mark({ size: 512, height: 200, drop: CREAM, hook: INK })),
  },
  'android-background': { png: 'images/android-icon-background.png', w: 512, h: 512, svg: svg(512, 512, '', INK) },
  'android-monochrome': {
    png: 'images/android-icon-monochrome.png',
    w: 432,
    h: 432,
    svg: svg(432, 432, mark({ size: 432, height: 168, drop: WHITE, hook: WHITE, cutOut: true })),
  },
  // Native splash: the static mark on the cream window background (the animated splash takes over in-app).
  splash: {
    png: 'images/splash-icon.png',
    w: 368,
    h: 512,
    svg: svg(368, 512, mark({ size: 368, canvasHeight: 512, height: 511, drop: INK, hook: CREAM })),
  },
  // Web favicon: at this size the hook is dropped, only the hanger base stays.
  favicon: {
    png: 'images/favicon.png',
    w: 48,
    h: 48,
    svg: svg(48, 48, `<rect width="48" height="48" rx="11" fill="${INK}"/>` + mark({ size: 48, height: 34, drop: CREAM, hook: INK, hookPath: BASE, strokeWidth: 3.4 })),
  },
};

// Layer for the iOS Icon Composer bundle (assets/expo.icon): the mark only, on a transparent canvas.
const iosLayer = svg(1024, 1024, mark({ size: 1024, height: 636, drop: CREAM, hook: INK }));

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH or export the SVGs in assets/brand/ with another tool.');
  return found;
}

const brandDir = join(root, 'assets', 'brand');
mkdirSync(brandDir, { recursive: true });
writeFileSync(join(root, 'assets', 'expo.icon', 'Assets', 'droblet-mark.svg'), iosLayer);

const chrome = findChrome();
for (const [name, asset] of Object.entries(assets)) {
  const source = join(brandDir, `${name}.svg`);
  writeFileSync(source, asset.svg);
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--window-size=${asset.w},${asset.h}`,
      `--screenshot=${join(root, 'assets', asset.png)}`,
      `file://${source}`,
    ],
    { stdio: 'ignore' },
  );
  console.log(`rendered assets/${asset.png} (${asset.w}×${asset.h})`);
}
