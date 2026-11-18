import { getDictionary, localePath, type Locale } from '@/lib/i18n';
import { Wordmark } from './Logo';

/**
 * Site header (canvas `Landing`): wordmark, three section links and the download CTA.
 * Section links are absolute to the landing page so they also work from the inner pages.
 */
export function Header({ locale }: { locale: Locale }) {
  const t = getDictionary(locale).header;
  const home = localePath(locale, '/');
  const navLink = 'flex min-h-11 items-center px-2.5 text-[15px] text-ink no-underline hover:text-accent';

  return (
    <header className="border-b border-line bg-cream">
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
        <a href={home} aria-label={t.homeAria} className="flex min-h-11 items-center gap-2 text-ink no-underline">
          <Wordmark />
        </a>
        <nav aria-label={t.navAria} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <a href={`${home}#how`} className={navLink}>
            {t.how}
          </a>
          <a href={`${home}#features`} className={navLink}>
            {t.features}
          </a>
          <a href={`${home}#membership`} className={navLink}>
            {t.membership}
          </a>
          <a href={`${home}#download`} className="btn btn-compact ml-2">
            {t.cta}
          </a>
        </nav>
      </div>
    </header>
  );
}
