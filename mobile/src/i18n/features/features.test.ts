import en from '../en.json';
import tr from '../tr.json';

import { featureFiles } from './index';

type Json = { [key: string]: Json | string };

function keys(obj: Json, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`)));
}

function values(obj: Json): string[] {
  return Object.values(obj).flatMap((v) => (typeof v === 'string' ? [v] : values(v)));
}

describe('feature translation files', () => {
  it.each(Object.entries(featureFiles))('%s: TR and EN have exactly the same keys', (_name, file) => {
    expect(keys(file.en as Json).sort()).toEqual(keys(file.tr as Json).sort());
  });

  it('no top-level key is defined twice (base files or another feature file)', () => {
    const owner = new Map<string, string>();
    [...Object.keys(tr), ...Object.keys(en)].forEach((k) => owner.set(k, 'base'));
    for (const [name, file] of Object.entries(featureFiles)) {
      for (const k of Object.keys(file.tr)) {
        expect(`${k}: ${owner.get(k) ?? name}`).toBe(`${k}: ${name}`);
        owner.set(k, name);
      }
    }
  });

  it('TR eyebrows / tags are written upper-case with the dotted İ (never transformed in code)', () => {
    const check = (obj: Json) => {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v !== 'string') check(v);
        else if (/(eyebrow|Tag)$/.test(k)) {
          const plain = v.replace(/\{\{[^}]+\}\}/g, '');
          expect(plain).toBe(plain.toLocaleUpperCase('tr-TR'));
        }
      }
    };
    Object.values(featureFiles).forEach((f) => check(f.tr as Json));
  });

  it('does not ship bracketed placeholders', () => {
    Object.values(featureFiles).forEach((f) =>
      [...values(f.tr as Json), ...values(f.en as Json)].forEach((v) => expect(v).not.toMatch(/\[[A-ZİĞÜŞÖÇ ]+\]/)),
    );
  });
});
