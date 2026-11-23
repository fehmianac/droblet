import type { Locale } from '@/lib/i18n';
import { screenSize, screenSrc, type ScreenName } from '@/lib/screens';

type Props = {
  locale: Locale;
  screen: ScreenName;
  alt: string;
  /** Width classes of the frame (Tailwind), e.g. `w-[280px]`. Every other size scales from it. */
  className?: string;
  /** The hero image loads eagerly; everything else is lazy. */
  eager?: boolean;
};

/**
 * A real app screenshot inside a CSS iPhone frame (bezel, rounded screen, dynamic island). Plain `<img>`:
 * `next/image` needs a loader that a static export does not have. The frame scales with its own width
 * (container query units in `.phone`), so one component serves the hero, the step cards and the gallery.
 */
export function PhoneFrame({ locale, screen, alt, className = 'w-[280px]', eager = false }: Props) {
  return (
    <div className={`phone ${className}`}>
      <div className="phone-body">
        <div className="phone-screen">
          {/* eslint-disable-next-line @next/next/no-img-element -- static export: no image loader */}
          <img
            src={screenSrc(locale, screen)}
            width={screenSize.width}
            height={screenSize.height}
            alt={alt}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={eager ? 'high' : undefined}
          />
          <span className="phone-island" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
