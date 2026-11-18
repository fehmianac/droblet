import type { Metadata } from 'next';
import { defaultLocale, getDictionary, localeInfo, localePath, locales, type Locale } from './i18n';
import { absoluteUrl, siteUrl } from './site';

type PageMeta = {
  locale: Locale;
  /** Path in the default language, with trailing slash ("/", "/terms/"). */
  page: string;
  title: string;
  description: string;
  /** Drafts and link fallbacks stay out of search results. */
  index?: boolean;
};

/** Title, description, canonical, hreflang alternates and Open Graph for one page in one language. */
export function pageMetadata({ locale, page, title, description, index = true }: PageMeta): Metadata {
  const dictionary = getDictionary(locale);
  const url = absoluteUrl(localePath(locale, page));
  const languages: Record<string, string> = Object.fromEntries(
    locales.map((other) => [localeInfo(other).htmlLang, absoluteUrl(localePath(other, page))]),
  );
  languages['x-default'] = absoluteUrl(localePath(defaultLocale, page));

  return {
    metadataBase: new URL(siteUrl),
    title,
    description,
    alternates: { canonical: url, languages },
    robots: index ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      type: 'website',
      url,
      siteName: dictionary.meta.siteName,
      title,
      description,
      locale: localeInfo(locale).ogLocale,
      alternateLocale: locales.filter((other) => other !== locale).map((other) => localeInfo(other).ogLocale),
      images: [{ url: absoluteUrl('/og.png'), width: 1200, height: 630, alt: dictionary.meta.ogImageAlt }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [absoluteUrl('/og.png')] },
  };
}
