'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { dictionaries, languages, type Dict } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { Permission } from '@/lib/types';
import { Icon, Logo, type IconName } from './icons';
import { LinkButton } from './forms';
import { ConfirmModal, EmptyState, Skeleton, cx } from './ui';

interface NavItem {
  key: Exclude<keyof Dict['nav'], 'groups'>;
  href: string;
  icon: IconName;
  permission: Permission;
}

interface NavGroup {
  key: keyof Dict['nav']['groups'];
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { key: 'overview', items: [{ key: 'dashboard', href: '/', icon: 'dashboard', permission: 'dashboard.view' }] },
  {
    key: 'catalog',
    items: [
      { key: 'brands', href: '/catalog/brands/', icon: 'tag', permission: 'catalog.manage' },
      { key: 'products', href: '/catalog/products/', icon: 'package', permission: 'catalog.manage' },
      { key: 'import', href: '/catalog/import/', icon: 'upload', permission: 'catalog.manage' },
    ],
  },
  {
    key: 'content',
    items: [
      { key: 'edits', href: '/content/edits/', icon: 'calendar', permission: 'content.manage' },
      { key: 'collections', href: '/content/collections/', icon: 'layers', permission: 'content.manage' },
      { key: 'library', href: '/content/library/', icon: 'book', permission: 'content.manage' },
    ],
  },
  {
    key: 'community',
    items: [
      { key: 'users', href: '/users/', icon: 'users', permission: 'users.read' },
      { key: 'moderation', href: '/moderation/', icon: 'flag', permission: 'moderation.manage' },
    ],
  },
  {
    key: 'reports',
    items: [
      { key: 'revenue', href: '/reports/revenue/', icon: 'trending', permission: 'analytics.view' },
      { key: 'funnel', href: '/reports/funnel/', icon: 'funnel', permission: 'analytics.view' },
    ],
  },
  {
    key: 'system',
    items: [
      { key: 'settings', href: '/settings/', icon: 'sliders', permission: 'settings.manage' },
      { key: 'admins', href: '/admins/', icon: 'shield', permission: 'admins.manage' },
      { key: 'audit', href: '/audit/', icon: 'list', permission: 'audit.view' },
    ],
  },
];

function stripLang(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length && (languages as string[]).includes(parts[0]!)) parts.shift();
  return `/${parts.join('/')}${parts.length ? '/' : ''}`;
}

function findItem(path: string): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const group of NAV) {
    for (const item of group.items) {
      const match = item.href === '/' ? path === '/' : path.startsWith(item.href);
      if (match && (!best || item.href.length > best.item.href.length)) best = { group, item };
    }
  }
  return best;
}

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { t, href } = useI18n();
  const { can, me } = useAuth();
  const path = stripLang(usePathname());
  const current = findItem(path);

  return (
    <aside
      className={cx(
        'fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-side-800 text-side-300 transition-transform lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex h-16 items-center gap-3 border-b border-side-700 px-5">
        <Logo className="h-8 w-8" tone="cream" />
        <div className="leading-tight">
          <p className="text-[15px] font-semibold text-white">Droblet</p>
          <p className="text-[11px] text-side-400">{t.topbar.environment}</p>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label={t.common.openMenu}>
        {NAV.map((group) => {
          const items = group.items.filter((i) => can(i.permission));
          if (!items.length) return null;
          return (
            <div key={group.key} className="mb-5">
              <p className="mb-2 px-3 text-[10.5px] font-semibold tracking-wider text-side-400">{t.nav.groups[group.key]}</p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = current?.item.key === item.key;
                  return (
                    <li key={item.key}>
                      <Link
                        href={href(item.href)}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cx(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors',
                          active ? 'bg-side-600 font-medium text-white' : 'hover:bg-side-700 hover:text-white',
                        )}
                      >
                        <span className={active ? 'text-brand-300' : 'text-side-400'}>
                          <Icon name={item.icon} className="h-[18px] w-[18px]" />
                        </span>
                        {t.nav[item.key]}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      {me && (
        <div className="border-t border-side-700 px-5 py-4 text-xs">
          <p className="truncate font-medium text-white">{me.name}</p>
          <p className="truncate text-side-400">{t.roles[me.role]}</p>
        </div>
      )}
    </aside>
  );
}

function Topbar({ onToggle }: { onToggle: () => void }) {
  const { t, lang, href } = useI18n();
  const { me, logout, logoutAll } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menu]);

  const switchTo = (next: string) => {
    const rest = stripLang(pathname);
    const qs = search.toString();
    router.push(`/${next}${rest}${qs ? `?${qs}` : ''}`);
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) router.push(href(`/users/?q=${encodeURIComponent(q.trim())}`));
  };

  const canSearch = me?.permissions.includes('users.read');

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur lg:px-8">
      <button type="button" onClick={onToggle} aria-label={t.topbar.toggleSidebar} className="rounded-lg p-2 text-muted hover:bg-stone-100 lg:hidden">
        <Icon name="menu" />
      </button>
      {canSearch ? (
        <form onSubmit={onSearch} role="search" className="relative w-full max-w-md">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t.topbar.searchLabel}
            placeholder={t.topbar.searchPlaceholder}
            className="h-10 w-full rounded-lg border border-transparent bg-stone-100 pr-3 pl-9 text-sm placeholder:text-stone-400 focus:border-brand-300 focus:bg-white focus:outline-none"
          />
        </form>
      ) : (
        <div className="flex-1" />
      )}
      <div className="ml-auto flex items-center gap-2">
        <label className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-stone-100">
          <Icon name="globe" className="h-4 w-4" />
          <span className="sr-only">{t.topbar.language}</span>
          <select value={lang} onChange={(e) => switchTo(e.target.value)} className="bg-transparent text-sm text-ink focus:outline-none">
            {languages.map((l) => (
              <option key={l} value={l}>
                {dictionaries[l].meta.languageName}
              </option>
            ))}
          </select>
        </label>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenu((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label={t.topbar.accountMenu}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-stone-100"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
              {(me?.name || me?.email || '?').slice(0, 1)}
            </span>
            <span className="hidden text-left leading-tight sm:block">
              <span className="block text-sm font-medium text-ink">{me?.name}</span>
              <span className="block text-xs text-muted">{me ? t.roles[me.role] : ''}</span>
            </span>
            <Icon name="chevronDown" className="h-4 w-4 text-muted" />
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-xl">
              <div className="border-b border-line px-4 py-3">
                <p className="truncate text-sm font-medium">{me?.name}</p>
                <p className="truncate text-xs text-muted">{me?.email}</p>
              </div>
              <Link role="menuitem" href={href('/account/')} onClick={() => setMenu(false)} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-stone-50">
                <Icon name="key" className="h-4 w-4 text-muted" />
                {t.topbar.changePassword}
              </Link>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setMenu(false);
                  setConfirmAll(true);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-stone-50"
              >
                <Icon name="shield" className="h-4 w-4 text-muted" />
                {t.topbar.logoutAll}
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => void logout('manual')}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50"
              >
                <Icon name="logout" className="h-4 w-4" />
                {t.topbar.logout}
              </button>
            </div>
          )}
        </div>
      </div>
      <ConfirmModal
        open={confirmAll}
        title={t.topbar.logoutAll}
        body={t.topbar.logoutAllConfirm}
        confirmLabel={t.topbar.logoutAll}
        danger
        onClose={() => setConfirmAll(false)}
        onConfirm={() => void logoutAll()}
      />
    </header>
  );
}

function Breadcrumbs() {
  const { t, href } = useI18n();
  const path = stripLang(usePathname());
  const found = findItem(path);
  if (!found || found.item.href === '/') return null;
  const deeper = path !== found.item.href;
  return (
    <nav aria-label="breadcrumb" className="mb-3 text-xs text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link href={href('/')} className="hover:text-ink">
            {t.common.breadcrumbHome}
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li>
          {deeper ? (
            <Link href={href(found.item.href)} className="hover:text-ink">
              {t.nav[found.item.key]}
            </Link>
          ) : (
            <span className="text-ink" aria-current="page">
              {t.nav[found.item.key]}
            </span>
          )}
        </li>
        {deeper && (
          <>
            <li aria-hidden="true">/</li>
            <li className="text-ink" aria-current="page">
              {t.common.details}
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}

export function PanelShell({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const { href } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (status === 'anonymous') {
      const next = stripLang(pathname);
      router.replace(href(`/login/${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`));
    }
  }, [status, router, href, pathname]);

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-screen">
        <div className="hidden w-64 bg-side-800 lg:block" />
        <div className="flex-1 space-y-4 p-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Sidebar open={open} onNavigate={() => setOpen(false)} />
      {open && <button type="button" aria-label="×" className="fixed inset-0 z-20 bg-side-900/40 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="lg:pl-64">
        <Topbar onToggle={() => setOpen((v) => !v)} />
        <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8 lg:py-8">
          <Breadcrumbs />
          {children}
        </main>
      </div>
    </div>
  );
}

/** Hides a page from roles that lack the permission (the server refuses the calls anyway). */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  const { t, href } = useI18n();
  if (!can(permission)) {
    return (
      <EmptyState
        icon="ban"
        title={t.errors.forbidden}
        action={
          <LinkButton href={href('/')} variant="secondary">
            {t.notFound.home}
          </LinkButton>
        }
      />
    );
  }
  return <>{children}</>;
}
