import type { Metadata } from 'next';
import { getDictionary, localePath, type Locale } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import type { ScreenName } from '@/lib/screens';
import { Footer } from './Footer';
import { Header } from './Header';
import { Icon } from './Icons';
import { LogoSymbol } from './Logo';
import { PhoneFrame } from './PhoneFrame';
import { RevealOnScroll } from './RevealOnScroll';
import { ScreenGallery } from './ScreenGallery';
import { StoreButtons } from './StoreButtons';

const privacyIcons = ['lock', 'trash', 'visibility'] as const;

/** Screenshot of each step of the loop (Dijitalleştir · Kombinle · Tamamla), in dictionary order. */
const stepScreens: readonly ScreenName[] = ['wardrobe', 'suggestion', 'product'];

/** Screenshot of each feature, in dictionary order. */
const featureScreens: readonly ScreenName[] = ['suggestion', 'today', 'looks', 'palette', 'shop', 'friends'];

/** Photographs (fictional, AI-made people) in `public/photos/`, with their pixel size. */
const photos = {
  hero: { src: '/photos/landing-hero.webp', width: 1536, height: 1024 },
  wardrobe: { src: '/photos/landing-wardrobe.webp', width: 1536, height: 1024 },
  tryOn: { src: '/photos/tryon-example-woman.webp', width: 800, height: 1200 },
  trip: { src: '/photos/landing-trip.webp', width: 1536, height: 1024 },
} as const;

/** The Akış band: editor photographs and look covers (fictional, AI-made), in the order of `home.photos.feed.alts`. */
const feedPhotos = ['feed-office', 'cover-navy-blazer', 'feed-weekend', 'cover-friend-dinner', 'feed-invite', 'story-trench'] as const;

/**
 * Features shown with a photograph instead of a screenshot (canvas `Landing`), by dictionary index; the
 * rest keep their phone frame. `position` is the crop focus inside the 4/3 card.
 */
const featurePhotos: Partial<Record<number, { key: 'wardrobe' | 'tryOn' | 'trip'; src: string; width: number; height: number; position: string }>> = {
  0: { key: 'wardrobe', ...photos.wardrobe, position: 'object-[60%_40%]' },
  1: { key: 'tryOn', ...photos.tryOn, position: 'object-[50%_12%]' },
  2: { key: 'trip', ...photos.trip, position: 'object-[60%_50%]' },
};

/** Index of the colour-palette feature: it also shows the sample tones as real swatches. */
const paletteFeature = 3;

const toneClasses = [
  'bg-tone-1',
  'bg-tone-2',
  'bg-tone-3',
  'bg-tone-4',
  'bg-tone-5',
  'bg-tone-6',
  'bg-tone-7',
  'bg-tone-8',
] as const;

/** Order of the screens gallery before the closing call to action. */
const galleryScreens: readonly ScreenName[] = [
  'welcome',
  'segment',
  'feed',
  'today',
  'wardrobe',
  'looks',
  'suggestion',
  'trip',
  'friends',
  'shop',
  'product',
  'palette',
  'membership',
];

export function homeMetadata(locale: Locale): Metadata {
  const t = getDictionary(locale).meta;
  return pageMetadata({ locale, page: '/', title: t.homeTitle, description: t.homeDescription });
}

/**
 * Landing page — canvas `Landing` (fluid desktop) / `LandingMobil` (the same layout at phone width): the
 * canvas' photographs in the hero and three feature cards, and its remaining image placeholders replaced by
 * real app screenshots in CSS phone frames.
 */
export function HomePage({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale);
  const t = dictionary.home;
  const screens = t.screens;
  const download = `${localePath(locale, '/')}#download`;

  return (
    <>
      <Header locale={locale} />
      <main id="main" className="overflow-x-clip">
        {/* Hero */}
        <section className="mx-auto flex max-w-page flex-wrap items-center gap-x-12 gap-y-14 px-4 pt-14 pb-16 sm:px-6 sm:pt-[72px] sm:pb-20">
          <div className="rise flex min-w-0 flex-[1_1_440px] flex-col gap-[22px]">
            <p className="eyebrow">{t.hero.eyebrow}</p>
            <h1 className="m-0 font-serif text-[clamp(40px,6vw,72px)] leading-none font-medium tracking-[-0.015em]">
              {t.hero.title}
            </h1>
            <p className="m-0 max-w-[520px] text-[19px] leading-normal text-muted">{t.hero.body}</p>
            <StoreButtons id="download" labels={dictionary.common} withIcon />
            <p className="small-text">{t.hero.platforms}</p>
          </div>

          <div className="rise-late flex min-w-0 flex-[1_1_320px] justify-center">
            <div className="relative w-[min(460px,100%)] pb-6">
              {/* eslint-disable-next-line @next/next/no-img-element -- static export: no image loader */}
              <img
                src={photos.hero.src}
                width={photos.hero.width}
                height={photos.hero.height}
                alt={t.photos.hero.alt}
                loading="eager"
                decoding="async"
                fetchPriority="high"
                className="block aspect-[4/5] w-full rounded-[28px] bg-sand object-cover object-[74%_50%]"
              />
              {/* The app itself, over the photo's lower-left corner (curtain and floor, clear of the subject). */}
              <div className="absolute bottom-0 -left-2 w-[34%] sm:-left-8">
                <PhoneFrame locale={locale} screen="feed" alt={screens.feed.alt} className="w-full" />
              </div>
            </div>
          </div>
        </section>

        {/* The loop: three steps */}
        <section id="how" className="border-y border-line bg-paper">
          <div className="mx-auto flex max-w-page flex-col gap-9 px-4 py-14 sm:px-6 sm:py-[72px]">
            <div className="flex max-w-[640px] flex-col gap-2.5" data-reveal>
              <p className="eyebrow">{t.how.eyebrow}</p>
              <h2 className="section-title">{t.how.title}</h2>
            </div>
            <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-6 p-0">
              {t.how.steps.map((step, index) => {
                const screen = stepScreens[index] ?? 'today';
                return (
                  <li key={step.title} className="flex flex-col overflow-hidden rounded-card border border-line bg-cream" data-reveal>
                    <div className={`stage h-[300px] rounded-none pt-8 ${index % 2 === 0 ? 'bg-sand' : 'bg-stage'}`}>
                      <PhoneFrame locale={locale} screen={screen} alt={screens[screen].alt} className="w-[230px]" />
                    </div>
                    <div className="flex flex-col gap-3 border-t border-line p-7">
                      <span aria-hidden="true" className="font-serif text-[44px] leading-none text-accent">
                        {index + 1}
                      </span>
                      <h3 className="heading-3">{step.title}</h3>
                      <p className="body-text">{step.body}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* Features — alternating rows */}
        <section id="features" className="mx-auto flex max-w-page flex-col gap-12 px-4 py-16 sm:gap-16 sm:px-6 sm:py-24">
          <div className="flex max-w-[640px] flex-col gap-2.5" data-reveal>
            <p className="eyebrow">{t.features.eyebrow}</p>
            <h2 className="section-title">{t.features.title}</h2>
          </div>
          {t.features.items.map((feature, index) => {
            const screen = featureScreens[index] ?? 'today';
            const photo = featurePhotos[index];
            const flipped = index % 2 === 1;
            return (
              <article
                key={feature.title}
                className="grid grid-cols-1 items-center gap-8 md:grid-cols-2 md:gap-16"
                data-reveal
              >
                <div className={`flex flex-col gap-4 md:max-w-[460px] ${flipped ? 'md:order-2' : ''}`}>
                  <span className="eyebrow text-accent">{feature.tag}</span>
                  <h3 className="m-0 font-serif text-[clamp(30px,3.4vw,40px)] leading-[1.08] font-medium">{feature.title}</h3>
                  <p className="m-0 text-[17px] leading-[1.6] text-muted">{feature.body}</p>
                  {index === paletteFeature ? (
                    <div className="mt-2 flex flex-col gap-3">
                      <p className="small-text">{t.features.tones.label}</p>
                      <ul className="m-0 grid max-w-[340px] list-none grid-cols-4 gap-x-3 gap-y-4 p-0">
                        {t.features.tones.names.map((name, tone) => (
                          <li key={name} className="flex flex-col items-center gap-1.5 text-center">
                            <span className={`swatch ${toneClasses[tone] ?? 'bg-sand'}`} aria-hidden="true" />
                            <span className="text-[12px] leading-tight text-ink">{name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
                {photo ? (
                  <div className={`relative aspect-[4/3] overflow-hidden rounded-card bg-sand ${flipped ? 'md:order-1' : ''}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- static export: no image loader */}
                    <img
                      src={photo.src}
                      width={photo.width}
                      height={photo.height}
                      alt={t.photos[photo.key].alt}
                      loading="lazy"
                      decoding="async"
                      className={`absolute inset-0 h-full w-full object-cover ${photo.position}`}
                    />
                    {photo.key === 'tryOn' ? <span className="tag absolute bottom-3.5 left-3.5">{t.photos.tryOn.tag}</span> : null}
                  </div>
                ) : (
                  <div
                    className={`stage h-[440px] items-start pt-10 sm:h-[520px] sm:pt-12 ${index % 2 === 0 ? 'bg-sand' : 'bg-stage'} ${flipped ? 'md:order-1' : ''}`}
                  >
                    <PhoneFrame locale={locale} screen={screen} alt={screens[screen].alt} className="w-[250px] sm:w-[280px]" />
                  </div>
                )}
              </article>
            );
          })}
        </section>

        {/* Akış: what the feed looks like */}
        <section id="feed" className="border-t border-line bg-paper">
          <div className="mx-auto flex max-w-page flex-col gap-9 px-4 py-14 sm:px-6 sm:py-[72px]">
            <div className="flex max-w-[640px] flex-col gap-2.5" data-reveal>
              <p className="eyebrow text-accent">{t.feed.eyebrow}</p>
              <h2 className="section-title">{t.feed.title}</h2>
              <p className="body-text text-[16px]">{t.feed.body}</p>
            </div>
            <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6" data-reveal>
              {feedPhotos.map((name, index) => (
                <li key={name} className="overflow-hidden rounded-card bg-sand">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static export: no image loader */}
                  <img
                    src={`/photos/${name}.webp`}
                    width={800}
                    height={1200}
                    alt={t.photos.feed.alts[index] ?? ''}
                    loading="lazy"
                    decoding="async"
                    className="block aspect-[2/3] w-full object-cover"
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Privacy promise */}
        <section className="on-ink bg-ink text-cream">
          <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-16 gap-y-8 px-4 py-16 sm:px-6 sm:py-20">
            <div className="flex flex-[1_1_360px] flex-col gap-3.5" data-reveal>
              <p className="eyebrow text-sand">{t.privacy.eyebrow}</p>
              <h2 className="m-0 font-serif text-[clamp(30px,3.6vw,44px)] leading-[1.1] font-medium">{t.privacy.title}</h2>
            </div>
            <ul className="m-0 flex flex-[1_1_320px] list-none flex-col gap-4 p-0 text-[16px] leading-normal text-sand" data-reveal>
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
          className="mx-auto flex max-w-page flex-wrap items-center gap-x-16 gap-y-12 px-4 py-16 sm:px-6 sm:py-24"
        >
          <div className="flex flex-[1_1_380px] flex-col gap-8" data-reveal>
            <div className="flex flex-col gap-3.5">
              <p className="eyebrow text-accent">{t.membership.eyebrow}</p>
              <h2 className="section-title">{t.membership.title}</h2>
              <p className="body-text text-[16px]">{t.membership.body}</p>
            </div>
            <div className="card flex flex-col gap-4 p-7">
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
          </div>
          <div className="stage h-[460px] flex-[1_1_340px] items-start bg-sand pt-10 sm:h-[560px] sm:pt-12" data-reveal>
            <PhoneFrame locale={locale} screen="membership" alt={screens.membership.alt} className="w-[270px] sm:w-[290px]" />
          </div>
        </section>

        {/* Screens gallery */}
        <section aria-labelledby="screens-title" className="border-t border-line bg-paper py-16 sm:py-20">
          <div className="mx-auto mb-8 flex max-w-page flex-col gap-2.5 px-4 sm:px-6" data-reveal>
            <p className="eyebrow">{t.gallery.eyebrow}</p>
            <h2 id="screens-title" className="section-title">
              {t.gallery.title}
            </h2>
          </div>
          <ScreenGallery
            locale={locale}
            items={galleryScreens.map((screen) => ({ screen, alt: screens[screen].alt, caption: screens[screen].caption }))}
            labels={{ region: t.gallery.region, previous: t.gallery.previous, next: t.gallery.next }}
          />
        </section>

        {/* Closing call to action */}
        <section className="bg-sand">
          <div className="mx-auto flex max-w-narrow flex-col items-center gap-5 px-4 py-16 text-center sm:px-6 sm:py-20">
            <LogoSymbol width={44} />
            <h2 className="m-0 font-serif text-[clamp(32px,4.4vw,52px)] leading-[1.05] font-medium">{t.final.title}</h2>
            <StoreButtons labels={dictionary.common} centered />
          </div>
        </section>
      </main>
      <RevealOnScroll />
      <Footer locale={locale} page="/" />
    </>
  );
}
