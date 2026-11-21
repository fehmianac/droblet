import { render, screen } from '@testing-library/react-native';

import { illustrationTones } from '@/theme/tokens';

import { EmptyIllustration, type EmptyIllustrationKind } from './EmptyIllustration';

const KINDS: EmptyIllustrationKind[] = ['wardrobe', 'looks', 'trips', 'watchlist', 'cart'];

describe('EmptyIllustration (canvas 22e `GorselBosSet`)', () => {
  it.each(KINDS)('%s: a 160 × 120 drawing at 168 × 126, decorative (the headline says it)', async (kind) => {
    await render(<EmptyIllustration kind={kind} />);
    const box = screen.getByTestId(`empty-illustration-${kind}`, { includeHiddenElements: true });
    expect(box.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(box.props.accessibilityElementsHidden).toBe(true);
    const svg = screen.toJSON() as { children: { type: string; props: Record<string, unknown> }[] };
    expect(svg.children[0].type).toBe('RNSVGSvgView');
    expect(svg.children[0].props).toMatchObject({ width: 168, height: 126, vbWidth: 160, vbHeight: 120 });
  });

  it('uses the board colours', () => {
    expect(illustrationTones).toEqual({
      ground: '#E8E1D7',
      wood: '#6E5640',
      ink: '#1C1A17',
      cream: '#F4F1EC',
      dash: '#A69B8E',
      suitcase: '#A89582',
      navy: '#2F3A4F',
      oat: '#D6CBBE',
      tick: '#9A3B2E',
    });
  });
});
