import './globals.css';

/**
 * Pass-through root. The `<html>` element belongs to each language's own layout (`(tr)/layout.tsx`,
 * `en/layout.tsx`) so `lang` is right in the exported HTML; `not-found.tsx` renders its own document.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
