import { toDisplayUpper } from './upper';

describe('toDisplayUpper', () => {
  it('uses Turkish casing (i → İ, ı → I)', () => {
    expect(toDisplayUpper('haftalık stil', 'tr')).toBe('HAFTALIK STİL');
    expect(toDisplayUpper('18 Kasım Çarşamba · İstanbul', 'tr')).toBe('18 KASIM ÇARŞAMBA · İSTANBUL');
  });

  it('uses plain casing for English', () => {
    expect(toDisplayUpper('marks & spencer', 'en')).toBe('MARKS & SPENCER');
  });
});
