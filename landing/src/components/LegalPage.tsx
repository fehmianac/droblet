import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getDictionary, type Dictionary, type Locale } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { PageShell } from './PageShell';

export type LegalDoc = keyof Dictionary['legal']['docs'];

/** Route of each legal document in the default language. Footer, route files and `npm run check` follow this list. */
export const legalRoutes: Record<LegalDoc, string> = {
  terms: '/terms/',
  privacy: '/privacy/',
  kvkk: '/kvkk/',
  consents: '/consents/',
  subscriptionTerms: '/subscription-terms/',
  cookies: '/cookies/',
  communityGuidelines: '/community-guidelines/',
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
 * Paragraphs that start with "- " are list items; consecutive items form one list. The dictionary stays a plain
 * list of strings (same shape in every language), the page still gets real <ul> markup.
 */
export function Blocks({ paragraphs }: { paragraphs: readonly string[] }) {
  const blocks: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[16px] leading-relaxed">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>,
    );
    items = [];
  };
  for (const paragraph of paragraphs) {
    if (paragraph.startsWith('- ')) {
      items.push(paragraph.slice(2));
      continue;
    }
    flush();
    blocks.push(
      <p key={`p-${blocks.length}`} className="m-0 text-[16px] leading-relaxed">
        {paragraph}
      </p>,
    );
  }
  flush();
  return <>{blocks}</>;
}

/**
 * A legal document rendered from the dictionary. Everything here is a DRAFT until legal review:
 * the banner says so on every page, and placeholders in [BRACKETS] mark facts the owner still has to supply.
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
          <p className="small-text m-0">
            {t.versionLabel}: {t.version}
          </p>
        </header>

        <p className="m-0 text-[17px] leading-relaxed">{content.intro}</p>

        <section aria-labelledby="summary" className="card flex flex-col gap-3 p-5">
          <h2 id="summary" className="eyebrow">
            {t.summaryLabel}
          </h2>
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[16px] leading-relaxed">
            {content.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

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
            <Blocks paragraphs={section.paragraphs} />
          </section>
        ))}
      </article>
    </PageShell>
  );
}
