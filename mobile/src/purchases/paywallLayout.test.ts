import { paywallCompact, paywallHeroHeight } from './paywallLayout';

describe('paywallHeroHeight (05)', () => {
  it('keeps the strip short enough for the whole offer above the footer on a 844 pt iPhone', () => {
    expect(paywallHeroHeight(844)).toBe(176);
    expect(paywallHeroHeight(932)).toBe(176);
  });

  it('shrinks it further below 740 pt, and to the compact strip on the iPhone SE (667 pt)', () => {
    expect(paywallHeroHeight(720)).toBe(136);
    expect(paywallHeroHeight(667)).toBe(76);
    expect(paywallCompact(667)).toBe(true);
    expect(paywallCompact(844)).toBe(false);
  });

  it('stays on the 4 pt grid', () => {
    for (const h of [568, 667, 739, 740, 844, 956]) expect(paywallHeroHeight(h) % 4).toBe(0);
  });
});
