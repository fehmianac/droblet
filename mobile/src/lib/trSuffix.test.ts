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
    expect(trSuffix('Vakko', 'locative')).toBe('da');
    expect(trSuffix('Sepet', 'locative')).toBe('te');
    expect(trSuffix('1 Aralık', 'locative')).toBe('ta');
    expect(trSuffix('1 Kasım', 'locative')).toBe('da');
    expect(trSuffix('Selin', 'accusative')).toBe('i');
    expect(trSuffix('Ayşe', 'accusative')).toBe('yi');
    expect(trSuffix('Kum', 'genitive')).toBe('un');
    expect(trSuffix('Studio', 'genitive')).toBe('nun');
    expect(trSuffix('IŞIK', 'accusative')).toBe('ı');
  });

  it('gives the catalogue brands the form they are read with', () => {
    const locative: [string, string][] = [
      ['Vakko', "Vakko'da"],
      ['Gap', "Gap'te"],
      ['Marks & Spencer', "Marks & Spencer'da"],
      ['Beymen Club', "Beymen Club'da"],
      ['Communité', "Communité'de"],
      ['Lululemon', "Lululemon'da"],
    ];
    locative.forEach(([brand, expected]) => expect(suffixed(brand, 'locative', 'tr')).toBe(expected));
    expect(suffixed('Marks & Spencer', 'genitive', 'tr')).toBe("Marks & Spencer'ın");
    expect(suffixed('Communité', 'genitive', 'tr')).toBe("Communité'nin");
    expect(suffixed('Gap', 'genitive', 'tr')).toBe("Gap'in");
    expect(suffixed('Vakko', 'genitive', 'tr')).toBe("Vakko'nun");
    expect(suffixed('Lululemon', 'genitive', 'tr')).toBe("Lululemon'un");
    expect(suffixed('Beymen Club', 'genitive', 'tr')).toBe("Beymen Club'un");
    expect(suffixed('MARKS & SPENCER', 'locative', 'tr')).toBe("MARKS & SPENCER'da");
  });

  it('only suffixes in Turkish and keeps the display text', () => {
    expect(suffixed(12, 'possessive', 'tr')).toBe("12'si");
    expect(suffixed(12, 'possessive', 'en')).toBe('12');
    expect(suffixed(64, 'possessive', 'tr', '%64')).toBe("%64'ü");
    expect(suffixed('Vakko', 'locative', 'tr')).toBe("Vakko'da");
  });
});
