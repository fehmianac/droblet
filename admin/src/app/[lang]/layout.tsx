import { notFound } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { isLang, languages } from '@/i18n';
import { I18nProvider } from '@/lib/i18n';

// One static tree per language: out/tr/…, out/en/… (a new language in the registry adds a tree).
export const dynamicParams = false;

export function generateStaticParams() {
  return languages.map((lang) => ({ lang }));
}

export default async function LangLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <I18nProvider lang={lang}>
      {/* Pages read ?id= / ?q= with useSearchParams, which a static export renders on the client. */}
      <Suspense fallback={null}>{children}</Suspense>
    </I18nProvider>
  );
}
