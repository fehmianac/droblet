import { en, type Dict } from './en';
import { tr } from './tr';

// Language registry. A third language = one dictionary file + one line here (+ its locale tag).
export const dictionaries = { tr, en } satisfies Record<string, Dict>;
export const locales: Record<Lang, string> = { tr: 'tr-TR', en: 'en-GB' };

export type Lang = keyof typeof dictionaries;
export const languages = Object.keys(dictionaries) as Lang[];
export const defaultLang: Lang = 'tr';

export function isLang(value: string | null | undefined): value is Lang {
  return !!value && (languages as string[]).includes(value);
}

export type { Dict };

/** "{count} rows" → "3 rows". */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => (key in vars ? String(vars[key]) : `{${key}}`));
}
