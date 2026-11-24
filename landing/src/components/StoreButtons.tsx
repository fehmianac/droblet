import type { Dictionary } from '@/lib/i18n';
import { appStoreUrl, playStoreUrl } from '@/lib/site';

type Props = {
  labels: Dictionary['common'];
  centered?: boolean;
  id?: string;
};

/**
 * Google's files carry their own clear space, and not the same in every language: the English badge is 168 of the
 * file's 250px height with space on all sides, the Turkish one 192 of 250 and full width. Each is sized and pulled
 * in so that the visible badge is 48px tall, like Apple's.
 */
const PLAY_FIT = {
  en: { className: '-m-3 block h-[72px] w-auto max-w-none', width: 186, height: 72 },
  tr: { className: '-my-[7px] block h-[62px] w-auto max-w-none', width: 160, height: 62 },
} as const;
/** Apple's badge at 48px: its width differs by language. */
const APPLE_WIDTH = { en: 144, tr: 182 } as const;

/**
 * The official store badges ("Download on the App Store", "Get it on Google Play"), unmodified artwork from Apple's
 * and Google's marketing tools, in the page language (`public/brand/store/`). A store whose URL is not configured
 * yet shows the badge without a link and "Yakında" under it, instead of a link that goes nowhere.
 */
export function StoreButtons({ labels, centered = false, id }: Props) {
  const lang = labels.storeBadge === 'tr' ? 'tr' : 'en';
  const stores = [
    { key: 'apple', url: appStoreUrl, label: labels.appStore, src: `/brand/store/app-store-${lang}.svg`, play: false },
    { key: 'google', url: playStoreUrl, label: labels.googlePlay, src: `/brand/store/google-play-${lang}.png`, play: true },
  ];

  return (
    <div id={id} className={`flex flex-wrap items-start gap-3 ${centered ? 'justify-center' : ''}`}>
      {stores.map((store) => {
        const badge = (
          <span className="block h-12 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={store.src}
              alt={store.label}
              width={store.play ? PLAY_FIT[lang].width : APPLE_WIDTH[lang]}
              height={store.play ? PLAY_FIT[lang].height : 48}
              className={store.play ? PLAY_FIT[lang].className : 'block h-12 w-auto max-w-none'}
            />
          </span>
        );
        return store.url ? (
          <a key={store.key} href={store.url} rel="noopener" className="block rounded-lg">
            {badge}
          </a>
        ) : (
          <span key={store.key} className="flex flex-col items-center gap-1.5">
            {badge}
            <span className="small-text">{labels.storeSoon}</span>
          </span>
        );
      })}
    </div>
  );
}
