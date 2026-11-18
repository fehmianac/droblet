import type { Metadata } from 'next';
import { getDictionary, localePath, type Locale } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { Footer } from './Footer';
import { Header } from './Header';
import { Icon } from './Icons';
import { LogoSymbol } from './Logo';
import { StoreButtons } from './StoreButtons';

const privacyIcons = ['lock', 'trash', 'visibility'] as const;

export function homeMetadata(locale: Locale): Metadata {
  const t = getDictionary(locale).meta;
  return pageMetadata({ locale, page: '/', title: t.homeTitle, description: t.homeDescription });
}

/** Landing page — canvas `Landing` (fluid desktop) / `LandingMobil` (the same layout at phone width). */
export function HomePage({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale);
  const t = dictionary.home;
  const download = `${localePath(locale, '/')}#download`;

  return (
    <>
      <Header locale={locale} />
      <main id="main">
        {/* Hero */}
        <section className="mx-auto flex max-w-page flex-wrap items-center gap-12 px-4 pt-14 pb-12 sm:px-6 sm:pt-[72px] sm:pb-16">
          <div className="rise flex min-w-0 flex-[1_1_440px] flex-col gap-[22px]">
            <p className="eyebrow">{t.hero.eyebrow}</p>
            <h1 className="m-0 font-serif text-[clamp(40px,6vw,72px)] leading-none font-medium tracking-[-0.015em]">
              {t.hero.title}
            </h1>
            <p className="m-0 max-w-[520px] text-[19px] leading-normal text-muted">{t.hero.body}</p>
            <StoreButtons id="download" labels={dictionary.common} withIcon />
            <p className="small-text">{t.hero.platforms}</p>
          </div>
          <div className="rise-late flex flex-[1_1_320px] justify-center">
            <div
              role="img"
              aria-label={t.hero.phoneAlt}
              className="flex aspect-[300/610] w-[min(300px,100%)] items-center justify-center rounded-phone border-8 border-ink bg-sand p-6 text-center"
            >
              <span className="small-text text-ink">{t.hero.phoneLabel}</span>
            </div>
          </div>
        </section>

        {/* The loop: three steps */}
        <section id="how" className="border-y border-line bg-paper">
          <div className="mx-auto flex max-w-page flex-col gap-9 px-4 py-14 sm:px-6 sm:py-[72px]">
            <div className="flex max-w-[640px] flex-col gap-2.5">
              <p className="eyebrow">{t.how.eyebrow}</p>
              <h2 className="section-title">{t.how.title}</h2>
            </div>
            <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-6 p-0">
              {t.how.steps.map((step, index) => (
                <li key={step.title} className="flex flex-col gap-3 rounded-card border border-line bg-cream p-7">
                  <span aria-hidden="true" className="font-serif text-[44px] leading-none text-accent">
                    {index + 1}
                  </span>
                  <h3 className="heading-3">{step.title}</h3>
                  <p className="body-text">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto flex max-w-page flex-col gap-9 px-4 py-16 sm:px-6 sm:py-20">
          <div className="flex max-w-[640px] flex-col gap-2.5">
            <p className="eyebrow">{t.features.eyebrow}</p>
            <h2 className="section-title">{t.features.title}</h2>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-6">
            {t.features.items.map((feature, index) => (
              <article key={feature.title} className="flex flex-col gap-3">
                <div
                  role="img"
                  aria-label={feature.alt}
                  className={`flex aspect-[4/3] items-end rounded-card p-3.5 ${index % 2 === 0 ? 'bg-sand' : 'bg-stage'}`}
                >
                  <span className="tag">{feature.tag}</span>
                </div>
                <h3 className="heading-3">{feature.title}</h3>
                <p className="body-text">{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Privacy promise */}
        <section className="on-ink bg-ink text-cream">
          <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-16 gap-y-8 px-4 py-16 sm:px-6 sm:py-20">
            <div className="flex flex-[1_1_360px] flex-col gap-3.5">
              <p className="eyebrow text-sand">{t.privacy.eyebrow}</p>
              <h2 className="m-0 font-serif text-[clamp(30px,3.6vw,44px)] leading-[1.1] font-medium">{t.privacy.title}</h2>
            </div>
            <ul className="m-0 flex flex-[1_1_320px] list-none flex-col gap-4 p-0 text-[16px] leading-normal text-sand">
              {t.privacy.points.map((point, index) => (
                <li key={point} className="flex gap-3">
                  <Icon name={privacyIcons[index % privacyIcons.length] ?? 'lock'} className="mt-0.5 flex-none text-cream" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Membership */}
        <section
          id="membership"
          className="mx-auto flex max-w-page flex-wrap items-start gap-x-16 gap-y-10 px-4 py-16 sm:px-6 sm:py-20"
        >
          <div className="flex flex-[1_1_380px] flex-col gap-3.5">
            <p className="eyebrow text-accent">{t.membership.eyebrow}</p>
            <h2 className="section-title">{t.membership.title}</h2>
            <p className="body-text text-[16px]">{t.membership.body}</p>
          </div>
          <div className="card flex flex-[1_1_360px] flex-col gap-4 p-7">
            <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
              {t.membership.benefits.map((benefit) => (
                <li key={benefit.title} className="flex items-start gap-3">
                  <Icon name="check" className="mt-0.5 flex-none" />
                  <span>
                    <span className="block font-medium">{benefit.title}</span>
                    <span className="small-text block">{benefit.body}</span>
                  </span>
                </li>
              ))}
            </ul>
            <hr className="m-0 border-0 border-t border-line" />
            <p className="m-0 text-[15px] font-medium">{t.membership.priceTitle}</p>
            <p className="small-text">{t.membership.priceNote}</p>
            <a href={download} className="btn">
              {t.membership.cta}
            </a>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="bg-sand">
          <div className="mx-auto flex max-w-narrow flex-col items-center gap-5 px-4 py-16 text-center sm:px-6 sm:py-20">
            <LogoSymbol width={40} surface="sand" strokeWidth={2.2} />
            <h2 className="m-0 font-serif text-[clamp(32px,4.4vw,52px)] leading-[1.05] font-medium">{t.final.title}</h2>
            <StoreButtons labels={dictionary.common} centered />
          </div>
        </section>
      </main>
      <Footer locale={locale} page="/" />
    </>
  );
}
