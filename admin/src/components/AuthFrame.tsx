'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { dictionaries, languages } from '@/i18n';
import { useI18n } from '@/lib/i18n';
import { Icon, Logo } from './icons';
import { cx } from './ui';

export function AuthFrame({ children }: { children: ReactNode }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const pathname = usePathname();

  const switchTo = (next: string) => {
    const rest = pathname.replace(new RegExp(`^/${lang}(?=/|$)`), '');
    router.push(`/${next}${rest || '/'}${window.location.search}`);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(480px,560px)]">
      <aside className="relative hidden overflow-hidden bg-side-800 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="flex items-center gap-3">
          <Logo className="h-10 w-10" />
          <span className="text-lg font-semibold text-white">Droblet</span>
        </div>
        <div className="relative z-10 max-w-md">
          <p className="text-3xl leading-tight font-semibold text-white">{t.meta.title}</p>
          <p className="mt-3 text-sm text-side-300">{t.auth.secureNote}</p>
        </div>
        <svg viewBox="0 0 400 400" className="pointer-events-none absolute -right-24 -bottom-24 h-[28rem] w-[28rem] opacity-[0.07]" aria-hidden="true">
          <path d="M200 30C200 30 70 175 70 270a130 130 0 0 0 260 0C330 175 200 30 200 30z" fill="#f4f1ec" />
        </svg>
        <p className="relative z-10 text-xs text-side-400">droblet-admin.alatech.co</p>
      </aside>
      <main className="flex flex-col bg-white">
        <div className="flex items-center justify-between px-6 py-5 lg:justify-end">
          <span className="flex items-center gap-2 lg:hidden">
            <Logo className="h-8 w-8" />
            <span className="font-semibold">Droblet</span>
          </span>
          <div className="flex items-center gap-1 rounded-lg border border-line p-1" role="group" aria-label={t.topbar.language}>
            <Icon name="globe" className="mx-1 h-4 w-4 text-muted" />
            {languages.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => switchTo(l)}
                aria-pressed={l === lang}
                className={cx('rounded-md px-2.5 py-1 text-xs font-medium', l === lang ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink')}
              >
                {dictionaries[l].meta.languageName}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  );
}
