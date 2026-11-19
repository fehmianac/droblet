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
/**
 * The bucket has no rewrites: a shared link in its path form (`/invite/CODE`, `/l/ID`, and the old `/i/CODE`)
 * lands here. Send it to the page's query form, which S3 serves, before anything renders; the rest of the
 * query (`t`, `id`, `u`, `invite`) is kept.
 */
const SHARED_LINK_REDIRECT = `(function(){try{var m=location.pathname.match(/^\\/(en\\/)?(i|invite|l)\\/([A-Za-z0-9_-]{1,64})\\/?$/);if(!m)return;var page=m[2]==='l'?'l':'invite';var q=new URLSearchParams(location.search);q.set(page==='l'?'id':'c',m[3]);location.replace('/'+(m[1]||'')+page+'/?'+q.toString());}catch(e){}})();`;

export default function NotFound() {
  return (
    <LocaleDocument locale={defaultLocale}>
      <script dangerouslySetInnerHTML={{ __html: SHARED_LINK_REDIRECT }} />
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
