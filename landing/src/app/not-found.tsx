import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { LocaleDocument } from '@/components/LocaleDocument';
import { defaultLocale, getDictionary, localeInfo, localePath, locales } from '@/lib/i18n';

export const metadata: Metadata = {
  title: getDictionary(defaultLocale).notFound.metaTitle,
  robots: { index: false, follow: false },
};

/**
 * Exported as `out/404.html`, the bucket's error document. One file answers every unknown path in every
 * language, so the message is shown in each registered language (default first).
 */
export default function NotFound() {
  return (
    <LocaleDocument locale={defaultLocale}>
      <Header locale={defaultLocale} />
      <main id="main" className="mx-auto flex max-w-prose flex-col gap-12 px-4 py-16 sm:px-6 sm:py-24">
        {locales.map((locale, index) => {
          const t = getDictionary(locale).notFound;
          const Heading = index === 0 ? 'h1' : 'h2';
          return (
            <section key={locale} lang={localeInfo(locale).htmlLang} className="flex flex-col gap-3">
              <p className="eyebrow">{t.eyebrow}</p>
              <Heading className="m-0 font-serif text-[clamp(36px,6vw,52px)] leading-[1.05] font-medium">{t.title}</Heading>
              <p className="m-0 text-[17px] leading-relaxed text-muted">{t.body}</p>
              <a href={localePath(locale, '/')} className="btn mt-2 self-start">
                {t.cta}
              </a>
            </section>
          );
        })}
      </main>
      <Footer locale={defaultLocale} page="/" />
    </LocaleDocument>
  );
}
