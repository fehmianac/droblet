import { render, screen } from '@testing-library/react-native';

import '@/i18n';

import { DROP_LOADER_LOOP_MS, DROP_LOADER_PHASES, DropLoader } from './DropLoader';

describe('DropLoader', () => {
  it('loops the splash mark in 1.6 s: draw, fill, hold, fade', () => {
    expect(DROP_LOADER_LOOP_MS).toBe(1600);
    const P = DROP_LOADER_PHASES;
    expect(P.outlineEnd).toBeLessThan(P.fadeStart);
    expect(P.fillStart).toBeLessThan(P.fillEnd);
    expect(P.hookEnd).toBeLessThanOrEqual(P.fadeStart);
  });

  it('screen size holds the whole content area and is a named, busy progress indicator', async () => {
    await render(<DropLoader size="screen" caption="Gardırobun hazırlanıyor" accessibilityLabel="Gardırop yükleniyor" testID="loader" />);
    const loader = screen.getByTestId('loader');
    expect(loader.props.accessibilityRole).toBe('progressbar');
    expect(loader.props.accessibilityLabel).toBe('Gardırop yükleniyor');
    expect(loader.props.accessibilityState).toEqual({ busy: true });
    expect(loader.props.className).toContain('flex-1');
    expect(screen.getByText('Gardırobun hazırlanıyor')).toBeTruthy();
  });

  it('inline size has no caption', async () => {
    await render(<DropLoader size="inline" caption="ignored" testID="loader" />);
    expect(screen.queryByText('ignored')).toBeNull();
  });
});
