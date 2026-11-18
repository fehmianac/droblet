'use client';

import { useEffect } from 'react';

/**
 * Scroll-in motion for elements marked `data-reveal`: opacity and transform only (CSS in globals.css).
 * Does nothing when the visitor asks for less motion or the browser has no IntersectionObserver, and
 * the content is fully visible without JavaScript — elements are hidden only once this has run.
 */
export function RevealOnScroll() {
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    // What is already on screen stays put: hiding it now would make it flicker.
    for (const element of elements) {
      if (element.getBoundingClientRect().top < window.innerHeight) element.classList.add('is-revealed');
    }
    document.documentElement.classList.add('reveal-ready');

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    for (const element of elements) {
      if (!element.classList.contains('is-revealed')) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  return null;
}
