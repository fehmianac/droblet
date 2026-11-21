import type { Metadata } from 'next';
import { getDictionary, localeInfo, localePath, type Locale } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { teenParentConsentEnabled } from '@/lib/site';
import { Icon } from './Icons';
import { Blocks } from './LegalPage';
import { PageShell } from './PageShell';
import { ParentConsentFlow } from './ParentConsentFlow';

/**
 * Parent page of the teen consent e-mail (`/parent-consent/?token=…`, docs/api/teen.md §5, §9). Not linked from
 * anywhere, never indexed, not in the sitemap.
 *
 * DRAFT FLAG: the notice and checkbox wording is pending legal review. Unless NEXT_PUBLIC_TEEN_PARENT_CONSENT is
 * exactly "1" at build time, only the neutral "not available yet" state is rendered and none of the
 * `parentConsent.draft` texts are rendered or passed to the client. `npm run check` asserts both modes.
 */
const route = '/parent-consent/';

export function parentConsentMetadata(locale: Locale): Metadata {
  const t = getDictionary(locale).parentConsent;
  return pageMetadata({ locale, page: route, title: t.metaTitle, description: t.metaDescription, index: false });
}

export function ParentConsentPage({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale);
  const t = dictionary.parentConsent;

  return (
    <PageShell locale={locale} page={route}>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="eyebrow">{t.eyebrow}</p>
          <h1 className="m-0 font-serif text-[clamp(36px,6vw,52px)] leading-[1.05] font-medium">{t.title}</h1>
        </header>
        {teenParentConsentEnabled ? <DraftConsent locale={locale} /> : <Unavailable title={t.unavailableTitle} body={t.unavailableBody} />}
      </div>
    </PageShell>
  );
}

function Unavailable({ title, body }: { title: string; body: string }) {
  return (
    <section className="card flex flex-col gap-2 p-6" aria-labelledby="consent-not-yet">
      <h2 id="consent-not-yet" className="heading-3">
        {title}
      </h2>
      <p className="body-text text-ink">{body}</p>
    </section>
  );
}

/** Rendered only with the draft flag on. */
function DraftConsent({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale);
  // The notice is rendered here; the client gets only the texts it switches between.
  const { sections, draftNote: _draftNote, ...texts } = dictionary.parentConsent.draft;
  void _draftNote;

  const notice = sections.map((section) => (
    <div key={section.title} className="flex flex-col gap-2">
      <h3 className="m-0 text-[17px] font-medium">{section.title}</h3>
      <Blocks paragraphs={section.paragraphs} />
    </div>
  ));

  return (
    <>
      <aside role="note" className="flex gap-3 rounded-card border border-danger bg-paper p-5">
        <Icon name="alert" className="mt-0.5 flex-none text-danger" />
        <div className="flex flex-col gap-1.5">
          <p className="m-0 flex flex-wrap items-center gap-2 font-medium text-danger">
            <span className="rounded-full border border-danger px-2.5 py-0.5 text-[11px] leading-[15px] tracking-[0.14em]">
              {texts.draftBadge}
            </span>
            {texts.draftTitle}
          </p>
          <p className="body-text text-ink">{texts.draftBody}</p>
        </div>
      </aside>
      <ParentConsentFlow
        locale={locale}
        htmlLang={localeInfo(locale).htmlLang}
        t={texts}
        common={dictionary.common}
        homeHref={localePath(locale, '/')}
        notice={notice}
      />
    </>
  );
}
