import type { MetadataRoute } from 'next';
import { localeInfo, localePath, locales } from '@/lib/i18n';
import { absoluteUrl } from '@/lib/site';

export const dynamic = 'force-static';

/**
 * Indexable pages only. Legal drafts and the deep-link fallbacks are `noindex` and stay out;
 * add the legal routes here when the reviewed texts go live. `/parent-consent/` (teen parental consent) is a private
 * e-mailed link and never belongs here (`npm run check` fails if it appears).
 */
const pages = ['/', '/delete-account/'];

export default function sitemap(): MetadataRoute.Sitemap {
  return pages.flatMap((page) =>
    locales.map((locale) => ({
      url: absoluteUrl(localePath(locale, page)),
      changeFrequency: 'monthly' as const,
      priority: page === '/' ? 1 : 0.3,
      alternates: {
        languages: Object.fromEntries(
          locales.map((other) => [localeInfo(other).htmlLang, absoluteUrl(localePath(other, page))]),
        ),
      },
    })),
  );
}
