/**
 * Turkish case suffixes for dynamic words (brand names, people's names, numbers), written after an
 * apostrophe: "Vakko'da öde", "Selin'i şikayet et", "30 görselden 12'si kaldı", "1 Aralık'ta".
 * Vowel harmony and consonant voicing are applied to the word as it is read; numbers are read in
 * Turkish first (12 → "on iki"). English strings never use these helpers (see `suffixed`).
 *
 * Foreign brand names are spelled differently from how they are read ("Gap" is read "gep"), so
 * the names we know carry their spoken form in `SPOKEN_AS`; any other foreign name gets a best
 * effort from its spelling.
 */
export type TrCase = 'possessive' | 'accusative' | 'locative' | 'genitive';

const VOWELS = 'aeıioöuü';
const BACK = 'aıou';
const ROUNDED = 'oöuü';
const VOICELESS = 'fstkçşhp';

const DIGITS = ['sıfır', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];

/** How a name is read aloud in Turkish, where the spelling would give the wrong suffix. Keys are lower-case. */
const SPOKEN_AS: Record<string, string> = {
  'marks & spencer': 'spensır',
  'm&s': 'es',
  gap: 'gep',
  communité: 'komünite',
  communite: 'komünite',
};

function lowerTr(value: string): string {
  return value.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
}

/** The last word of a number as it is read aloud — enough to pick the suffix. */
function numberReading(n: number): string {
  const value = Math.abs(Math.trunc(n));
  if (value === 0) return DIGITS[0] ?? '';
  const ones = value % 10;
  if (ones !== 0) return DIGITS[ones] ?? '';
  const tens = Math.floor(value / 10) % 10;
  if (tens !== 0) return TENS[tens] ?? '';
  if (Math.floor(value / 100) % 10 !== 0) return 'yüz';
  if (value % 1_000_000 !== 0) return 'bin';
  return 'milyon';
}

/** The pronounceable tail of a word: trailing digits are read as numbers, other symbols are skipped. */
function spokenTail(word: string): string {
  const known = SPOKEN_AS[lowerTr(word).trim()];
  if (known) return known;
  const cleaned = lowerTr(word).replace(/[^a-zçğıöşü0-9]+$/u, '');
  const digits = /(\d+)$/.exec(cleaned);
  return digits ? numberReading(Number(digits[1])) : cleaned;
}

function lastVowel(spoken: string): string {
  for (let i = spoken.length - 1; i >= 0; i--) {
    const ch = spoken[i] ?? '';
    if (VOWELS.includes(ch)) return ch;
  }
  return 'e';
}

/** ı / i / u / ü by vowel harmony. */
function highVowel(vowel: string): string {
  const back = BACK.includes(vowel);
  const rounded = ROUNDED.includes(vowel);
  if (back) return rounded ? 'u' : 'ı';
  return rounded ? 'ü' : 'i';
}

/** The bare suffix (without apostrophe) for a word or number. */
export function trSuffix(word: string | number, grammaticalCase: TrCase): string {
  const spoken = typeof word === 'number' ? numberReading(word) : spokenTail(word);
  const vowel = lastVowel(spoken);
  const last = spoken[spoken.length - 1] ?? '';
  const endsWithVowel = VOWELS.includes(last);
  const high = highVowel(vowel);

  switch (grammaticalCase) {
    case 'possessive':
      return endsWithVowel ? `s${high}` : high;
    case 'accusative':
      return endsWithVowel ? `y${high}` : high;
    case 'genitive':
      return endsWithVowel ? `n${high}n` : `${high}n`;
    case 'locative':
      return `${VOICELESS.includes(last) ? 't' : 'd'}${BACK.includes(vowel) ? 'a' : 'e'}`;
  }
}

/**
 * `value` with its Turkish suffix ("12'si") when the app language is Turkish; unchanged for English,
 * whose sentences carry the grammar in the translation string itself.
 */
export function suffixed(
  value: string | number,
  grammaticalCase: TrCase,
  language: 'tr' | 'en',
  display: string = String(value),
): string {
  return language === 'tr' ? `${display}'${trSuffix(value, grammaticalCase)}` : display;
}
