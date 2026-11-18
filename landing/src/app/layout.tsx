import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-ext-500.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-ext-600.css';
import '@fontsource/jost/latin-400.css';
import '@fontsource/jost/latin-ext-400.css';
import '@fontsource/jost/latin-500.css';
import '@fontsource/jost/latin-ext-500.css';
import './globals.css';

/**
 * Pass-through root. The `<html>` element belongs to each language's own layout (`(tr)/layout.tsx`,
 * `en/layout.tsx`) so `lang` is right in the exported HTML; `not-found.tsx` renders its own document.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
