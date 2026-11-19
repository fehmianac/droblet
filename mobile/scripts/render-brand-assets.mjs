#!/usr/bin/env node
/**
 * Renders the app icon / splash PNGs from the logo mark (direction B "askı monogramı", canvas v2
 * `Logo.dc.html`): a "D" drawn from a hanger curve with a drop in its counter, in a rounded square.
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
const DROP_ON_INK = '#B49A80';
const WHITE = '#FFFFFF';

/** Same geometry as src/components/brand/logoPaths.ts: the 44 × 44 tile at (6, 10), rx 12. */
const BOX = 44;
const D = 'M20 22v20h6.5a10 10 0 0 0 0-20H20M20 22c0-3 1.6-5 4-5.4';
const DROP = 'M27 27c0 0-3.2 3.6-3.2 6a3.2 3.2 0 0 0 6.4 0c0-2.4-3.2-6-3.2-6z';
const STROKE = 2.6;

function round(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * The mark scaled so its 44-unit tile is `tile` px, centred in a `size`×`size` canvas.
 * `withTile: false` leaves the square out (icon layers whose background is the ink tile itself).
 */
function mark({ size, tile, withTile = true, tileFill = INK, stroke = CREAM, drop = DROP_ON_INK }) {
  const scale = tile / BOX;
  const offset = (size - tile) / 2;
  const body =
    (withTile ? `<rect x="6" y="10" width="44" height="44" rx="12" fill="${tileFill}"/>` : '') +
    `<path d="${D}" fill="none" stroke="${stroke}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${DROP}" fill="${drop}"/>`;
  return `<g transform="translate(${round(offset)} ${round(offset)}) scale(${round(scale)}) translate(-6 -10)">${body}</g>`;
}

function svg(width, height, body, background) {
  const bg = background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bg}\n  ${body}\n</svg>\n`;
}

/**
 * - iOS / store icon: the tile IS the icon — ink full bleed (the OS rounds the corners), the cream "D"
 *   and the drop at the tile's own proportions.
 * - Android adaptive (108 dp layer, 72 dp visible): the tile is mapped onto the visible 72 dp, so the
 *   "D" sits where it sits in the square; background = ink.
 */
const ANDROID_TILE = 72 / 108;

/** name → { png (relative to assets/), width, height, svg } */
const assets = {
  icon: { png: 'images/icon.png', w: 1024, h: 1024, svg: svg(1024, 1024, mark({ size: 1024, tile: 1024, withTile: false }), INK) },
  'android-foreground': {
    png: 'images/android-icon-foreground.png',
    w: 512,
    h: 512,
    svg: svg(512, 512, mark({ size: 512, tile: 512 * ANDROID_TILE, withTile: false })),
  },
  'android-background': { png: 'images/android-icon-background.png', w: 512, h: 512, svg: svg(512, 512, '', INK) },
  // Monochrome (themed icons): only alpha counts — the "D" and the drop in white.
  'android-monochrome': {
    png: 'images/android-icon-monochrome.png',
    w: 432,
    h: 432,
    svg: svg(432, 432, mark({ size: 432, tile: 432 * ANDROID_TILE, withTile: false, stroke: WHITE, drop: WHITE })),
  },
  // Native splash: the whole mark (ink tile) on the cream window background; the animated splash takes
  // over in-app at the same size and place (app.config.ts shows it 92 wide = MARK_WIDTH in AnimatedSplash).
  splash: { png: 'images/splash-icon.png', w: 432, h: 432, svg: svg(432, 432, mark({ size: 432, tile: 432 })) },
  // Web favicon: the mark itself, rounded square included.
  favicon: { png: 'images/favicon.png', w: 48, h: 48, svg: svg(48, 48, mark({ size: 48, tile: 48 })) },
};

// Layer for the iOS Icon Composer bundle (assets/expo.icon, whose fill is ink): the "D" and the drop only.
const iosLayer = svg(1024, 1024, mark({ size: 1024, tile: 1024, withTile: false }));

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
