import { suffixed, trSuffix } from './trSuffix';

describe('trSuffix', () => {
  it('reads numbers aloud for the possessive ("N\'si kaldı")', () => {
    const cases: [number, string][] = [
      [0, 'ı'], [1, 'i'], [2, 'si'], [3, 'ü'], [4, 'ü'], [5, 'i'], [6, 'sı'], [7, 'si'], [8, 'i'], [9, 'u'],
      [10, 'u'], [12, 'si'], [20, 'si'], [30, 'u'], [40, 'ı'], [50, 'si'], [60, 'ı'], [64, 'ü'], [70, 'i'],
      [80, 'i'], [90, 'ı'], [100, 'ü'], [1000, 'i'],
    ];
    cases.forEach(([n, suffix]) => expect([n, trSuffix(n, 'possessive')]).toEqual([n, suffix]));
  });

  it('applies vowel harmony and consonant voicing to names', () => {
    expect(trSuffix('Liman', 'locative')).toBe('da');
    expect(trSuffix('Ada Club', 'locative')).toBe('da');
    expect(trSuffix('Sepet', 'locative')).toBe('te');
    expect(trSuffix('Defne & Co', 'locative')).toBe('da');
    expect(trSuffix('1 Aralık', 'locative')).toBe('ta');
    expect(trSuffix('1 Kasım', 'locative')).toBe('da');
    expect(trSuffix('Selin', 'accusative')).toBe('i');
    expect(trSuffix('Ayşe', 'accusative')).toBe('yi');
    expect(trSuffix('Maison Kum', 'genitive')).toBe('un');
    expect(trSuffix('Sade Studio', 'genitive')).toBe('nun');
    expect(trSuffix('IŞIK', 'accusative')).toBe('ı');
  });

  it('only suffixes in Turkish and keeps the display text', () => {
    expect(suffixed(12, 'possessive', 'tr')).toBe("12'si");
    expect(suffixed(12, 'possessive', 'en')).toBe('12');
    expect(suffixed(64, 'possessive', 'tr', '%64')).toBe("%64'ü");
    expect(suffixed('Liman', 'locative', 'tr')).toBe("Liman'da");
  });
});
