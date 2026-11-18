'use client';

import { useRef } from 'react';
import type { Locale } from '@/lib/i18n';
import type { ScreenName } from '@/lib/screens';
import { Icon } from './Icons';
import { PhoneFrame } from './PhoneFrame';

type Item = { screen: ScreenName; alt: string; caption: string };

type Props = {
  locale: Locale;
  items: Item[];
  labels: { region: string; previous: string; next: string };
};

/**
 * Horizontal strip of app screens. Scroll-snap does the layout; the strip itself is focusable, so the
 * arrow keys scroll it, and the two buttons move it by most of its width for pointer users.
 */
export function ScreenGallery({ locale, items, labels }: Props) {
  const strip = useRef<HTMLDivElement>(null);

  const move = (direction: 1 | -1) => {
    const element = strip.current;
    if (!element) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollBy({ left: direction * element.clientWidth * 0.8, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <div className="flex flex-col gap-6">
      <div ref={strip} className="gallery-strip" tabIndex={0} role="region" aria-label={labels.region}>
        <ul className="gallery-list">
          {items.map((item) => (
            <li key={item.screen} className="gallery-item">
              <PhoneFrame locale={locale} screen={item.screen} alt={item.alt} className="w-[200px] sm:w-[220px]" />
              <span className="small-text text-center text-ink">{item.caption}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mx-auto flex w-full max-w-page justify-end gap-2 px-4 sm:px-6">
        <button type="button" className="gallery-button" onClick={() => move(-1)} aria-label={labels.previous}>
          <Icon name="chevronLeft" />
        </button>
        <button type="button" className="gallery-button" onClick={() => move(1)} aria-label={labels.next}>
          <Icon name="chevronRight" />
        </button>
      </div>
    </div>
  );
}
