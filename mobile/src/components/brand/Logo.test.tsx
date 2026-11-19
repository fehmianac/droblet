/// <reference types="node" />
import { render, screen } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import '@/i18n';
import { brandTones, palettes } from '@/theme/tokens';

import { Logo, LogoMark, markColors } from './Logo';
import { D_PATH, D_STROKE_WIDTH, DROP_PATH, MARK_ASPECT, MARK_VIEWBOX, MIN_LOCKUP_WIDTH, MIN_MARK_WIDTH, TILE, logoClearSpace } from './logoPaths';

const root = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Copied verbatim from column B of the canvas board `Logo.dc.html`. */
const CANVAS = {
  tile: { x: 6, y: 10, size: 44, rx: 12 },
  d: 'M20 22v20h6.5a10 10 0 0 0 0-20H20M20 22c0-3 1.6-5 4-5.4',
  dStroke: 2.6,
  drop: 'M27 27c0 0-3.2 3.6-3.2 6a3.2 3.2 0 0 0 6.4 0c0-2.4-3.2-6-3.2-6z',
  ink: '#1C1A17',
  cream: '#F4F1EC',
  /** The drop on the ink tile (logo on cream) and on the cream tile (logo on ink). */
  dropOnInk: '#B49A80',
  dropOnCream: '#6E5640',
};

describe('logo — canvas direction B (askı monogramı)', () => {
  it('uses the canvas tile, paths and colours 1:1', () => {
    expect(TILE).toEqual({ x: CANVAS.tile.x, y: CANVAS.tile.y, size: CANVAS.tile.size, radius: CANVAS.tile.rx });
    expect(D_PATH).toBe(CANVAS.d);
    expect(D_STROKE_WIDTH).toBe(CANVAS.dStroke);
    expect(DROP_PATH).toBe(CANVAS.drop);
    expect(MARK_VIEWBOX).toBe('6 10 44 44');
    expect(MARK_ASPECT).toBe(1);
    expect(palettes.light.ink).toBe(CANVAS.ink);
    expect(palettes.light.cream).toBe(CANVAS.cream);
    expect(brandTones.dropOnInk).toBe(CANVAS.dropOnInk);
    expect(palettes.light.accent).toBe(CANVAS.dropOnCream);
  });

  it('colours: ink tile + cream D + light espresso drop on cream; reversed on ink', () => {
    expect(markColors('ink', palettes.light)).toEqual({ tile: CANVAS.ink, stroke: CANVAS.cream, drop: CANVAS.dropOnInk });
    expect(markColors('cream', palettes.light)).toEqual({ tile: CANVAS.cream, stroke: CANVAS.ink, drop: CANVAS.dropOnCream });
  });

  it('clear space is a quarter of the tile; minimum sizes', () => {
    expect(logoClearSpace(44)).toBe(11);
    expect(MIN_MARK_WIDTH).toBe(16);
    expect(MIN_LOCKUP_WIDTH).toBe(96);
  });

  it('never renders the mark below 16 wide and keeps it square', async () => {
    await render(<LogoMark width={8} accessibilityLabel="mark" />);
    const { width, height } = screen.getByLabelText('mark').props as { width: number; height: number };
    expect(width).toBe(16);
    expect(height).toBe(16);
  });

  it.each(['header', 'hero', 'stacked'] as const)('announces the %s lock-up once, as the brand name', async (size) => {
    await render(<Logo size={size} />);
    expect(screen.getByLabelText('Droblet')).toBeTruthy();
    expect(screen.getByText('Droblet')).toBeTruthy();
  });
});

describe('generated icon / splash sources', () => {
  const script = read('scripts/render-brand-assets.mjs');

  it('the renderer and the in-app mark share the same geometry', () => {
    expect(script).toContain(`const D = '${CANVAS.d}';`);
    expect(script).toContain(`const DROP = '${CANVAS.drop}';`);
    expect(script).toContain(`const STROKE = ${CANVAS.dStroke};`);
    expect(script).toContain(`const DROP_ON_INK = '${CANVAS.dropOnInk}';`);
  });

  it.each(['icon', 'android-foreground', 'splash', 'favicon'])('%s.svg carries the canvas D and drop in brand colours only', (name) => {
    const svg = read(`assets/brand/${name}.svg`);
    expect(svg).toContain(CANVAS.d);
    expect(svg).toContain(CANVAS.drop);
    const colours = new Set(svg.match(/#[0-9A-Fa-f]{6}/g));
    expect([...colours].every((c) => [CANVAS.ink, CANVAS.cream, CANVAS.dropOnInk].includes(c))).toBe(true);
  });

  it('the icon is the tile itself (ink full bleed, cream D); the splash and favicon show the rounded square', () => {
    const icon = read('assets/brand/icon.svg');
    expect(icon).toContain(`fill="${CANVAS.ink}"/>`);
    expect(icon).toContain(`stroke="${CANVAS.cream}"`);
    expect(icon).not.toContain('rx="12"');
    expect(read('assets/brand/splash.svg')).toContain(`<rect x="6" y="10" width="44" height="44" rx="12" fill="${CANVAS.ink}"/>`);
    expect(read('assets/brand/favicon.svg')).toContain('rx="12"');
  });

  it('the iOS icon layer is the same D and drop (the bundle fill is the ink tile)', () => {
    const layer = read('assets/expo.icon/Assets/droblet-mark.svg');
    expect(layer).toContain(CANVAS.d);
    expect(layer).toContain(CANVAS.drop);
  });
});
