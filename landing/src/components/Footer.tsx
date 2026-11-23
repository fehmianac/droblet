import { getDictionary, localeInfo, localePath, locales, type Locale } from '@/lib/i18n';
import { contactEmail, siteHost } from '@/lib/site';
import { Wordmark } from './Logo';

type Props = {
  locale: Locale;
  /** Path of the current page in the default language — the language switch keeps the visitor on it. */
  page: string;
};

export function Footer({ locale, page }: Props) {
  const t = getDictionary(locale).footer;
  const link = 'flex min-h-11 items-center text-[14px] text-ink underline underline-offset-3 hover:text-accent';
  const legal = [
    { href: '/terms/', label: t.terms },
    { href: '/privacy/', label: t.privacy },
    { href: '/kvkk/', label: t.kvkk },
    { href: '/consents/', label: t.consents },
    { href: '/subscription-terms/', label: t.subscription },
    { href: '/cookies/', label: t.cookies },
    { href: '/community-guidelines/', label: t.communityGuidelines },
    { href: '/delete-account/', label: t.deleteAccount },
  ];

  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-page flex-wrap items-start justify-between gap-x-12 gap-y-6 px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2">
            <Wordmark size="footer" />
          </span>
          <p className="small-text">
            {t.copyright} · {siteHost}
            <br />
            {t.address}
            <br />
            {t.registration}
          </p>
        </div>

        <nav aria-label={t.navAria} className="flex flex-wrap gap-x-5">
          {legal.map((item) => (
            <a key={item.href} href={localePath(locale, item.href)} className={link}>
              {item.label}
            </a>
          ))}
          {contactEmail ? (
            <a href={`mailto:${contactEmail}`} className={link}>
              {t.contact}
            </a>
          ) : null}
        </nav>

        <div role="group" aria-label={t.langAria} className="flex gap-[3px] rounded-full bg-sand p-[3px]">
          {locales.map((other) => {
            const info = localeInfo(other);
            const current = other === locale;
            return (
              <a
                key={other}
                href={localePath(other, page)}
                hrefLang={info.htmlLang}
                lang={info.htmlLang}
                aria-label={info.name}
                aria-current={current ? 'true' : undefined}
                className={`flex h-11 min-w-11 items-center justify-center rounded-full px-4 text-[14px] text-ink no-underline ${
                  current ? 'bg-paper font-medium' : 'hover:bg-cream'
                }`}
              >
                {info.label}
              </a>
            );
          })}
        </div>
      </div>
    </footer>
  );
}
