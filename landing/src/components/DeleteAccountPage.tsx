import type { Metadata } from 'next';
import { getDictionary, localePath, type Locale } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { appleSubscriptionsUrl, googleSubscriptionsUrl } from '@/lib/site';
import { DeleteAccountFlow } from './DeleteAccountFlow';
import { Icon } from './Icons';
import { PageShell } from './PageShell';

const page = '/delete-account/';

export function deleteAccountMetadata(locale: Locale): Metadata {
  const t = getDictionary(locale).deleteAccount;
  return pageMetadata({ locale, page, title: t.metaTitle, description: t.metaDescription });
}

/** `/delete-account` — what is deleted (same wording as the app's confirmation screen) and the web flow. */
export function DeleteAccountPage({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale);
  const t = dictionary.deleteAccount;

  return (
    <PageShell locale={locale} page={page}>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="eyebrow">{t.eyebrow}</p>
          <h1 className="m-0 font-serif text-[clamp(36px,6vw,52px)] leading-[1.05] font-medium">{t.title}</h1>
          <p className="m-0 text-[17px] leading-relaxed text-muted">{t.intro}</p>
        </header>

        <section className="flex flex-col gap-3" aria-labelledby="delete-what">
          <h2 id="delete-what" className="heading-3">
            {t.whatTitle}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {t.whatItems.map((item) => (
              <li key={item} className="flex gap-3">
                <Icon name="trash" className="mt-0.5 flex-none text-danger" />
                {item}
              </li>
            ))}
          </ul>
          <p className="m-0 font-medium text-danger">{t.irreversible}</p>
        </section>

        <section className="flex flex-col gap-2 rounded-card bg-sand p-6" aria-labelledby="delete-subscription">
          <h2 id="delete-subscription" className="heading-3">
            {t.subscriptionTitle}
          </h2>
          <p className="m-0">{t.subscriptionNote}</p>
          <ul className="m-0 flex list-none flex-wrap gap-x-6 p-0">
            <li>
              <a href={appleSubscriptionsUrl} className="text-link inline-flex min-h-11 items-center" rel="noopener">
                {t.manageApple}
              </a>
            </li>
            <li>
              <a href={googleSubscriptionsUrl} className="text-link inline-flex min-h-11 items-center" rel="noopener">
                {t.manageGoogle}
              </a>
            </li>
          </ul>
        </section>

        <DeleteAccountFlow locale={locale} t={t} common={dictionary.common} homeHref={localePath(locale, '/')} />

        <section className="flex flex-col gap-2" aria-labelledby="delete-social">
          <h2 id="delete-social" className="heading-3">
            {t.socialTitle}
          </h2>
          <p className="m-0">{t.socialBody}</p>
        </section>
      </div>
    </PageShell>
  );
}
