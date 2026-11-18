import type { Metadata } from 'next';
import { getDictionary, type Dictionary, type Locale } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { Icon } from './Icons';
import { PageShell } from './PageShell';

export type LegalDoc = keyof Dictionary['legal']['docs'];

/** Route of each legal document in the default language. */
export const legalRoutes: Record<LegalDoc, string> = {
  terms: '/terms/',
  privacy: '/privacy/',
  kvkk: '/kvkk/',
  subscriptionTerms: '/subscription-terms/',
  cookies: '/cookies/',
};

export function legalMetadata(locale: Locale, doc: LegalDoc): Metadata {
  const t = getDictionary(locale);
  const content = t.legal.docs[doc];
  return pageMetadata({
    locale,
    page: legalRoutes[doc],
    title: `${content.title} — ${t.meta.siteName}`,
    description: content.description,
    // Drafts are reachable by link (store listings need the URLs) but not offered to search engines.
    index: false,
  });
}

/**
 * A legal document rendered from the dictionary. Everything here is a DRAFT until legal review:
 * the banner says so on every page, and the text makes no commitment beyond the product handoff.
 */
export function LegalPage({ locale, doc }: { locale: Locale; doc: LegalDoc }) {
  const t = getDictionary(locale).legal;
  const content = t.docs[doc];

  return (
    <PageShell locale={locale} page={legalRoutes[doc]}>
      <article className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="eyebrow">{content.eyebrow}</p>
          <h1 className="m-0 font-serif text-[clamp(36px,6vw,52px)] leading-[1.05] font-medium">{content.title}</h1>
        </header>

        <aside role="note" className="flex gap-3 rounded-card border border-danger bg-paper p-5">
          <Icon name="alert" className="mt-0.5 flex-none text-danger" />
          <div className="flex flex-col gap-1.5">
            <p className="m-0 flex flex-wrap items-center gap-2 font-medium text-danger">
              <span className="rounded-full border border-danger px-2.5 py-0.5 text-[11px] leading-[15px] tracking-[0.14em]">
                {t.draftBadge}
              </span>
              {t.draftTitle}
            </p>
            <p className="body-text text-ink">{t.draftBody}</p>
          </div>
        </aside>

        <p className="m-0 text-[17px] leading-relaxed">{content.intro}</p>

        <dl className="m-0 flex flex-wrap gap-x-2 text-[15px]">
          <dt className="font-medium">{t.controllerLabel}:</dt>
          <dd className="m-0 text-muted">{t.controller}</dd>
        </dl>

        <nav aria-label={t.tocLabel} className="card p-5">
          <p className="eyebrow mb-2">{t.tocLabel}</p>
          <ol className="m-0 list-decimal pl-5 text-[15px]">
            {content.sections.map((section, index) => (
              <li key={section.heading}>
                <a href={`#s${index + 1}`} className="text-link inline-flex min-h-11 items-center">
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {content.sections.map((section, index) => (
          <section key={section.heading} id={`s${index + 1}`} className="flex flex-col gap-3">
            <h2 className="m-0 font-serif text-[28px] leading-[1.15] font-semibold">
              {index + 1}. {section.heading}
            </h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="m-0 text-[16px] leading-relaxed">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </article>
    </PageShell>
  );
}
