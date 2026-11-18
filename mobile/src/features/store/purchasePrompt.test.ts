import type { ProductSummary, PurchasePrompt } from '@/api/contracts/store';

import { nextPurchasePrompt } from './purchasePrompt';

const product = { id: 'p1', brandId: 'gap', brandName: 'Gap', name: 'Gömlek' } as ProductSummary;
const prompt = (id: string, receivedAt: string, products: ProductSummary[] = [product]): PurchasePrompt => ({
  id,
  brandId: 'gap',
  brandName: 'Gap',
  products,
  receivedAt,
});

describe('purchase prompt ("Gardıroba ekleyelim mi?")', () => {
  it('offers the oldest pending prompt not shown in this session', () => {
    const list = [prompt('B', '2026-11-19T10:00:00Z'), prompt('A', '2026-11-18T10:00:00Z')];
    expect(nextPurchasePrompt(list, new Set())?.id).toBe('A');
    expect(nextPurchasePrompt(list, new Set(['A']))?.id).toBe('B');
    expect(nextPurchasePrompt(list, new Set(['A', 'B']))).toBeNull();
  });

  it('offers nothing without prompts or without products', () => {
    expect(nextPurchasePrompt(undefined, new Set())).toBeNull();
    expect(nextPurchasePrompt([], new Set())).toBeNull();
    expect(nextPurchasePrompt([prompt('A', '2026-11-18T10:00:00Z', [])], new Set())).toBeNull();
  });
});
