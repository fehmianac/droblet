import { fontVariables } from '@/lib/fonts';
import { getDictionary, localeInfo, type Locale } from '@/lib/i18n';

/**
 * The `<html>` element of one language. Each language has its own root layout (`src/app/(tr)/layout.tsx`,
 * `src/app/en/layout.tsx`) so `lang` is correct in the static HTML, not patched in by script.
 */
export function LocaleDocument({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const t = getDictionary(locale).common;
  return (
    <html lang={localeInfo(locale).htmlLang} className={fontVariables}>
      <body className="bg-cream font-sans text-ink">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded-full focus:bg-ink focus:px-5 focus:py-3 focus:text-cream"
        >
          {t.skipToContent}
        </a>
        {children}
      </body>
    </html>
  );
}
