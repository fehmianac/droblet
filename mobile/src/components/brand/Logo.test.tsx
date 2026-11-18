/// <reference types="node" />
import { render, screen } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import '@/i18n';
import { palettes } from '@/theme/tokens';

import { Logo, LogoMark, markStroke } from './Logo';
import {
  DROP_PATH,
  HANGER_BASE_PATH,
  HOOK_PATH,
  MARK_ASPECT,
  MARK_BOX_HEIGHT,
  MARK_VIEWBOX,
  MIN_LOCKUP_WIDTH,
  MIN_MARK_WIDTH,
  logoClearSpace,
} from './logoPaths';

const root = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Copied verbatim from the canvas boards `Logo.dc.html` / `LogoIkon.dc.html` / `LogoKullanim.dc.html`. */
const CANVAS = {
  drop: 'M26 6C26 6 10 24 10 36a16 16 0 0 0 32 0C42 24 26 6 26 6z',
  hook: 'M23.4 27a2.7 2.7 0 1 1 3.8 2.5c-.8.3-1.2.9-1.2 1.7v1.5M26 32.7 15.8 40.6h20.4z',
  base: 'M26 32.7 15.8 40.6h20.4z',
  viewBox: '8 4 36 42',
  ink: '#1C1A17',
  cream: '#F4F1EC',
};

describe('logo — canvas direction A', () => {
  it('uses the canvas paths, box and colours 1:1', () => {
    expect(DROP_PATH).toBe(CANVAS.drop);
    expect(HOOK_PATH).toBe(CANVAS.hook);
    expect(HANGER_BASE_PATH).toBe(CANVAS.base);
    expect(MARK_VIEWBOX).toBe(CANVAS.viewBox);
    expect(MARK_ASPECT).toBeCloseTo(36 / 42);
    expect(palettes.light.ink).toBe(CANVAS.ink);
    expect(palettes.light.cream).toBe(CANVAS.cream);
  });

  it('draws the hook as LogoIkon does per size: base only up to 18, 2.6 up to 35, 2.2 from 44', () => {
    expect(markStroke(17)).toEqual({ path: CANVAS.base, strokeWidth: 3.4 });
    expect(markStroke(18)).toEqual({ path: CANVAS.base, strokeWidth: 3.4 });
    expect(markStroke(20)).toEqual({ path: CANVAS.hook, strokeWidth: 2.6 });
    expect(markStroke(35)).toEqual({ path: CANVAS.hook, strokeWidth: 2.6 });
    expect(markStroke(44)).toEqual({ path: CANVAS.hook, strokeWidth: 2.2 });
    expect(markStroke(104)).toEqual({ path: CANVAS.hook, strokeWidth: 2.2 });
  });

  it('keeps the LogoKullanim rules: clear space of half the drop width, minimum sizes', () => {
    // The drop is 32 of the 36-wide box.
    expect(logoClearSpace(36)).toBe(16);
    expect(logoClearSpace(20)).toBeCloseTo(8.89, 2);
    expect(MIN_MARK_WIDTH).toBe(16);
    expect(MIN_LOCKUP_WIDTH).toBe(96);
  });

  it('never renders the mark below 16 wide and never changes its ratio', async () => {
    await render(<LogoMark width={8} accessibilityLabel="mark" />);
    const { width, height } = screen.getByLabelText('mark').props as { width: number; height: number };
    expect(width).toBe(16);
    expect(width / height).toBeCloseTo(36 / 42);
  });

  it.each(['header', 'hero', 'stacked'] as const)('announces the %s lock-up once, as the brand name', async (size) => {
    await render(<Logo size={size} />);
    expect(screen.getByLabelText('Droblet')).toBeTruthy();
    expect(screen.getByText('Droblet')).toBeTruthy();
  });
});

describe('generated icon / splash sources', () => {
  const script = read('scripts/render-brand-assets.mjs');

  it('the renderer and the in-app mark share the same box', () => {
    expect(script).toContain(`const BOX_H = ${MARK_BOX_HEIGHT};`);
    expect(script).toContain(`const DROP = '${CANVAS.drop}';`);
    expect(script).toContain(`const HOOK = '${CANVAS.hook}';`);
  });

  it.each(['icon', 'android-foreground', 'splash'])('%s.svg carries the canvas drop and hook in ink and cream only', (name) => {
    const svg = read(`assets/brand/${name}.svg`);
    expect(svg).toContain(CANVAS.drop);
    expect(svg).toContain(CANVAS.hook);
    const colours = new Set(svg.match(/#[0-9A-Fa-f]{6}/g));
    expect([...colours].every((c) => c === CANVAS.ink || c === CANVAS.cream)).toBe(true);
  });

  it('the default icon is the cream drop on ink; the splash is the ink drop on cream', () => {
    expect(read('assets/brand/icon.svg')).toContain(`<path d="${CANVAS.drop}" fill="${CANVAS.cream}"/>`);
    expect(read('assets/brand/icon.svg')).toContain(`fill="${CANVAS.ink}"/>`);
    expect(read('assets/brand/splash.svg')).toContain(`<path d="${CANVAS.drop}" fill="${CANVAS.ink}"/>`);
  });

  it('the small icon (favicon = 29 px) drops the hook and keeps the hanger base', () => {
    const svg = read('assets/brand/favicon.svg');
    expect(svg).toContain(CANVAS.base);
    expect(svg).not.toContain(CANVAS.hook);
    expect(svg).toContain('stroke-width="3.4"');
  });

  it('the iOS icon layer is the same mark', () => {
    const layer = read('assets/expo.icon/Assets/droblet-mark.svg');
    expect(layer).toContain(CANVAS.drop);
    expect(layer).toContain(CANVAS.hook);
  });
});
