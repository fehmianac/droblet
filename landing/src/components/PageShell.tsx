import type { Locale } from '@/lib/i18n';
import { Footer } from './Footer';
import { Header } from './Header';

type Props = {
  locale: Locale;
  /** Path of the page in the default language ("/terms/"). */
  page: string;
  children: React.ReactNode;
};

/** Header + a single reading column + footer: every page that is not the landing itself. */
export function PageShell({ locale, page, children }: Props) {
  return (
    <>
      <Header locale={locale} />
      <main id="main" className="mx-auto max-w-prose px-4 py-12 sm:px-6 sm:py-16">
        {children}
      </main>
      <Footer locale={locale} page={page} />
    </>
  );
}
