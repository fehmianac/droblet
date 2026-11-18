import en from './en.json';
import tr from './tr.json';

type Json = { [key: string]: Json | string };

function keys(obj: Json, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  );
}

function values(obj: Json): string[] {
  return Object.values(obj).flatMap((v) => (typeof v === 'string' ? [v] : values(v)));
}

describe('translations', () => {
  it('TR and EN have exactly the same keys', () => {
    expect(keys(en as Json).sort()).toEqual(keys(tr as Json).sort());
  });

  it('upper-case labels use the Turkish dotted İ (no ASCII "I" where "İ" is meant)', () => {
    // Eyebrows written upper-case in TR must not contain a lower-case "i".
    const eyebrows = [tr.style.eyebrow, tr.body.eyebrow, tr.firstItems.eyebrow, tr.today.lookEyebrow, tr.aiBadge.onYou];
    eyebrows.forEach((label) => expect(label).toBe(label.toLocaleUpperCase('tr-TR')));
    expect(tr.style.eyebrow).toBe('STİL PROFİLİ');
  });

  it('does not ship price placeholders', () => {
    [...values(tr as Json), ...values(en as Json)].forEach((v) => expect(v).not.toMatch(/\[(FİYAT|AYLIK FİYAT|YILLIK FİYAT|PLAN ADI)\]/));
  });
});
