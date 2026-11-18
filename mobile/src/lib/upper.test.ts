import { toBrandUpper, toDisplayUpper } from './upper';

describe('toDisplayUpper', () => {
  it('uses Turkish casing (i → İ, ı → I)', () => {
    expect(toDisplayUpper('haftalık stil', 'tr')).toBe('HAFTALIK STİL');
    expect(toDisplayUpper('18 Kasım Çarşamba · İstanbul', 'tr')).toBe('18 KASIM ÇARŞAMBA · İSTANBUL');
  });

  it('uses plain casing for English', () => {
    expect(toDisplayUpper('marks & spencer', 'en')).toBe('MARKS & SPENCER');
  });
});

describe('toBrandUpper', () => {
  it('never applies Turkish casing to a foreign brand name', () => {
    expect(toBrandUpper('Communité')).toBe('COMMUNITÉ');
    expect(toBrandUpper('Communité')).not.toBe('COMMUNİTÉ');
    expect(toBrandUpper('Lululemon')).toBe('LULULEMON');
    expect(toBrandUpper('Marks & Spencer')).toBe('MARKS & SPENCER');
    expect(toBrandUpper('Beymen Club')).toBe('BEYMEN CLUB');
    expect(toBrandUpper('Vakko')).toBe('VAKKO');
    expect(toBrandUpper('Gap')).toBe('GAP');
  });

  it('differs from the Turkish UI casing exactly where it must', () => {
    // A Turkish UI word still gets the dotted İ …
    expect(toDisplayUpper('indirim', 'tr')).toBe('İNDİRİM');
    // … while the same helper would misspell the brand.
    expect(toDisplayUpper('Communité', 'tr')).toBe('COMMUNİTÉ');
    expect(toBrandUpper('Communité')).toBe('COMMUNITÉ');
  });

  it('keeps capitals a brand already writes', () => {
    expect(toBrandUpper('İpekyol')).toBe('İPEKYOL');
  });
});
