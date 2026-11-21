import { curtainRevealMs, curtainRows, curtainStepMs } from './TryOnCurtain';
import { inDressingOrder, isWornPiece, toTryOnPieces, tryOnPieces } from './pieces';

const label = (p: { category: string }) => `[${p.category}]`;

describe('curtain rows (21e)', () => {
  const pieces = [
    { name: 'Blazer', category: 'outerwear' as const },
    { name: 'Pantolon', category: 'bottom' as const },
    { name: 'Loafer', category: 'shoes' as const },
    { name: 'Çanta', category: 'bag' as const },
  ];

  it('"Hazır" + the opening take ~1.2 s (was 2.45 s); with reduce motion the curtain fades in less', () => {
    expect(curtainRevealMs(false)).toBe(1200);
    expect(curtainRevealMs(true)).toBeLessThan(1200);
  });

  it('shares ~24 s between the pieces, 3–7 s each', () => {
    expect(curtainStepMs(1)).toBe(7000);
    expect(curtainStepMs(4)).toBe(6000);
    expect(curtainStepMs(12)).toBe(3000);
  });

  it('puts the pieces on one by one; the last stays active until the result', () => {
    expect(curtainRows(pieces, 0, false, label, 'Kombin').map((r) => r.state)).toEqual(['active', 'pending', 'pending', 'pending']);
    expect(curtainRows(pieces, 6500, false, label, 'Kombin').map((r) => r.state)).toEqual(['done', 'active', 'pending', 'pending']);
    expect(curtainRows(pieces, 120_000, false, label, 'Kombin').map((r) => r.state)).toEqual(['done', 'done', 'done', 'active']);
    expect(curtainRows(pieces, 1000, true, label, 'Kombin').every((r) => r.state === 'done')).toBe(true);
  });

  it('no pieces → one outfit row; a nameless piece reads as its category', () => {
    expect(curtainRows([], 0, false, label, 'Kombin')).toEqual([{ key: '0', name: 'Kombin', worn: true, state: 'active' }]);
    expect(curtainRows([{ name: null, category: 'shoes' }], 0, false, label, 'Kombin')[0]?.name).toBe('[shoes]');
  });

  it('bags and accessories are added, the rest worn', () => {
    expect(['top', 'outerwear', 'bottom', 'dress', 'shoes'].every((c) => isWornPiece(c as never))).toBe(true);
    expect(isWornPiece('bag') || isWornPiece('accessory')).toBe(false);
  });
});

describe('try-on pieces', () => {
  it('maps the wire (unknown category → accessory, blank name → none) and keeps them per job', () => {
    const mapped = toTryOnPieces([
      { name: ' Blazer ', category: 'outerwear' },
      { name: ' ', category: 'hat' },
    ]);
    expect(mapped).toEqual([
      { name: 'Blazer', category: 'outerwear' },
      { name: null, category: 'accessory' },
    ]);
    tryOnPieces.record('job_1', mapped);
    tryOnPieces.record('job_2', []);
    expect(tryOnPieces.get('job_1')).toHaveLength(2);
    expect(tryOnPieces.get('job_2')).toEqual([]);
    expect(tryOnPieces.get(undefined)).toEqual([]);
  });

  it('orders like the server: tops, outerwear, bottoms, shoes, bags, accessories', () => {
    const order = inDressingOrder([
      { name: 'a', category: 'accessory' },
      { name: 'b', category: 'shoes' },
      { name: 'c', category: 'bottom' },
      { name: 'd', category: 'outerwear' },
      { name: 'e', category: 'top' },
      { name: 'f', category: 'bag' },
    ]).map((p) => p.category);
    expect(order).toEqual(['top', 'outerwear', 'bottom', 'shoes', 'bag', 'accessory']);
  });
});
