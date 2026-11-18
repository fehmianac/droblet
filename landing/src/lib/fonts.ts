import { Cormorant_Garamond, Jost } from 'next/font/google';

/**
 * next/font downloads the files at build time and serves them from /_next/static — the browser never
 * talks to Google. latin-ext carries the Turkish letters (İ ı ş ğ).
 */
export const serif = Cormorant_Garamond({
  subsets: ['latin', 'latin-ext'],
  weight: ['500', '600'],
  display: 'swap',
  variable: '--font-cormorant',
  fallback: ['Georgia', 'serif'],
});

export const sans = Jost({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-jost',
  fallback: ['system-ui', 'sans-serif'],
});

export const fontVariables = `${serif.variable} ${sans.variable}`;
