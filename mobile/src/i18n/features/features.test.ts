import { LANGUAGES, SUPPORTED_LANGUAGES } from '@/i18n';

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
  it('every language has the same feature files with the same keys', () => {
    const reference = featureFiles.tr;
    SUPPORTED_LANGUAGES.forEach((language) => {
      const files = featureFiles[language];
      expect(Object.keys(files).sort()).toEqual(Object.keys(reference).sort());
      (Object.keys(reference) as (keyof typeof reference)[]).forEach((file) =>
        expect(keys(files[file] as Json).sort()).toEqual(keys(reference[file] as Json).sort()),
      );
    });
  });

  it('top-level keys are unique across files and do not shadow the base file', () => {
    const top = Object.values(featureFiles.tr).flatMap((file) => Object.keys(file));
    expect(new Set(top).size).toBe(top.length);
    top.forEach((key) => {
      expect(Object.keys(tr)).not.toContain(key);
      expect(Object.keys(en)).not.toContain(key);
    });
  });

  it('upper-case labels are typed upper-case per language (Turkish with dotted İ)', () => {
    const { commerce, social: _social, account } = featureFiles.tr;
    void _social;
    const strip = (label: string) => label.replace(/\{\{\w+\}\}/g, '');
    [
      commerce.explore.editEyebrow,
      commerce.explore.sponsored,
      commerce.shop.brandEyebrow,
      commerce.shop.sortEyebrow,
      commerce.watchlist.eyebrow,
      account.me.creditsEyebrow,
      account.settings.visibilityEyebrow,
      account.settings.photosEyebrow,
      account.settings.languageEyebrow,
      account.deleteAccount.eyebrow,
      account.deleteAccount.confirmWord,
      account.palette.seasonEyebrow,
      account.palette.avoidEyebrow,
      account.credits.eyebrow,
    ].forEach((label) => expect(strip(label)).toBe(strip(label).toLocaleUpperCase('tr-TR')));
    expect(account.settings.notificationsEyebrow).toBe('BİLDİRİMLER');
    const enAccount = featureFiles.en.account;
    expect(enAccount.settings.photosEyebrow).toBe(enAccount.settings.photosEyebrow.toUpperCase());
  });

  it('ships no price or brand placeholders and registers every language', () => {
    SUPPORTED_LANGUAGES.forEach((language) => {
      Object.values(featureFiles[language]).forEach((file) =>
        values(file as Json).forEach((v) => expect(v).not.toMatch(/\[(FİYAT|MARKA|Marka)\]|₺|%\{\{/)),
      );
      expect(LANGUAGES[language].name.length).toBeGreaterThan(0);
    });
  });
});
