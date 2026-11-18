'use client';

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { defaultLang, dictionaries, fmt, isLang, locales, type Dict, type Lang } from '@/i18n';
import { ApiError, setLanguage } from './api';

const LANG_KEY = 'droblet-admin.lang';

interface I18n {
  lang: Lang;
  t: Dict;
  fmt: typeof fmt;
  href: (path: string) => string;
  date: (iso: string | null | undefined) => string;
  dateTime: (iso: string | null | undefined) => string;
  number: (n: number | null | undefined) => string;
  money: (minor: number | null | undefined, currency?: string) => string;
  percent: (ratio: number | null | undefined) => string;
  errorText: (error: unknown) => string;
  fieldError: (code: string) => string;
}

const Ctx = createContext<I18n | null>(null);

export function rememberLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // storage blocked
  }
}

export function savedLang(): string | null {
  try {
    return localStorage.getItem(LANG_KEY);
  } catch {
    return null;
  }
}

/** "/" → the saved language, else the browser language when supported, else Turkish. */
export function preferredLang(): Lang {
  const saved = savedLang();
  if (isLang(saved)) return saved;
  const browser = (typeof navigator !== 'undefined' ? navigator.language : '').slice(0, 2).toLowerCase();
  return isLang(browser) ? browser : defaultLang;
}

/** "/catalog/products/?id=x" → "/tr/catalog/products/?id=x" (always a trailing slash before the query). */
export function localHref(lang: Lang, path: string): string {
  const [p = '/', q] = path.split('?');
  let clean = p.startsWith('/') ? p : `/${p}`;
  if (!clean.endsWith('/')) clean += '/';
  return `/${lang}${clean === '/' ? '/' : clean}${q ? `?${q}` : ''}`;
}

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo<I18n>(() => {
    const t = dictionaries[lang];
    const locale = locales[lang];
    const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
    const dateTimeFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    const numberFmt = new Intl.NumberFormat(locale);
    const pct = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
    const codes = t.errors.codes as Record<string, string>;
    const fields = t.errors.fields as Record<string, string>;
    return {
      lang,
      t,
      fmt,
      href: (path) => localHref(lang, path),
      date: (iso) => (iso ? dateFmt.format(new Date(iso)) : '—'),
      dateTime: (iso) => (iso ? dateTimeFmt.format(new Date(iso)) : '—'),
      number: (n) => (n === null || n === undefined ? '—' : numberFmt.format(n)),
      money: (minor, currency = 'TRY') =>
        minor === null || minor === undefined
          ? '—'
          : new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100),
      percent: (ratio) => (ratio === null || ratio === undefined ? '—' : pct.format(ratio)),
      errorText: (error) => {
        if (error instanceof ApiError) {
          if (codes[error.code]) return codes[error.code]!;
          if (error.status === 403) return t.errors.forbidden;
          if (error.status === 404) return t.errors.notFound;
          if (error.status === 0) return t.errors.network;
        }
        return t.errors.generic;
      },
      fieldError: (code) => fields[code] ?? codes[code] ?? t.common.invalid,
    };
  }, [lang]);

  useEffect(() => {
    setLanguage(lang);
    rememberLang(lang);
    document.documentElement.lang = lang;
    document.title = dictionaries[lang].meta.title;
  }, [lang]);

  // Set synchronously too, so the first API call already carries the right Accept-Language.
  setLanguage(lang);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Ctx);
  if (!value) throw new Error('useI18n outside I18nProvider');
  return value;
}
