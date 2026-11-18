/**
 * Fonts are self-hosted from @fontsource (imported once in app/layout.tsx): the build never fetches from
 * Google — next/font/google failed intermittently on CI when Google's CSS response was not what it expected —
 * and the browser never talks to Google either. Only latin + latin-ext faces are imported (Turkish İ ı ş ğ).
 * The CSS variables keep the names the stylesheet already uses.
 */
export const fontVariables = 'font-vars';
