'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { RequirePermission } from '@/components/Shell';
import { Icon } from '@/components/icons';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Input, PageHeader, TableSkeleton, useAsync, type Column } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { AppUserSummary, Paged } from '@/lib/types';

function UsersInner() {
  const { t, href, date } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const urlQ = params.get('q') ?? '';
  const [q, setQ] = useState(urlQ);
  const [tokens, setTokens] = useState<(string | null)[]>([null]);

  useEffect(() => {
    setQ(urlQ);
    setTokens([null]);
  }, [urlQ]);

  const pageToken = tokens[tokens.length - 1] ?? null;
  const page = useAsync(() => api.get<Paged<AppUserSummary>>('v1/admin/user', { query: { q: urlQ, pageToken, limit: 25 } }), [urlQ, pageToken]);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    router.replace(href(`/users/${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`));
  };

  const columns: Column<AppUserSummary>[] = [
    {
      key: 'user',
      header: t.users.displayName,
      render: (u) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
            {(u.displayName || u.email || '?').slice(0, 1)}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              <span className="truncate">{u.displayName || '—'}</span>
              {u.ageBand === 'teen' && <Badge tone="brand">{t.users.teenBadge}</Badge>}
            </p>
            <p className="truncate text-xs text-muted">{u.handle ? `@${u.handle}` : u.id}</p>
          </div>
        </div>
      ),
    },
    { key: 'email', header: t.users.email, render: (u) => u.email ?? '—' },
    { key: 'created', header: t.common.createdAt, sortValue: (u) => u.createdAt, render: (u) => <span className="text-muted">{date(u.createdAt)}</span> },
    { key: 'status', header: t.common.status, render: (u) => (u.suspended ? <Badge tone="red">{t.users.suspended}</Badge> : <Badge tone="green">{t.common.active}</Badge>) },
    { key: 'go', header: <span className="sr-only">{t.common.view}</span>, className: 'text-right', render: () => <Icon name="chevronRight" className="ml-auto h-4 w-4 text-muted" /> },
  ];

  return (
    <div>
      <PageHeader title={t.users.title} subtitle={t.users.subtitle} />
      <Card padded={false}>
        <form onSubmit={onSearch} className="flex flex-wrap gap-3 border-b border-line px-5 py-3" role="search">
          <div className="relative w-full max-w-md">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400">
              <Icon name="search" className="h-4 w-4" />
            </span>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.users.searchPlaceholder} aria-label={t.common.search} className="pl-9" />
          </div>
          <Button type="submit" variant="secondary">
            {t.common.search}
          </Button>
        </form>
        {page.loading ? (
          <TableSkeleton />
        ) : page.error ? (
          <ErrorState error={page.error} onRetry={page.reload} />
        ) : (
          <DataTable
            columns={columns}
            rows={page.data?.items ?? []}
            rowKey={(u) => u.id}
            onRowClick={(u) => router.push(href(`/users/detail/?id=${encodeURIComponent(u.id)}`))}
            empty={<EmptyState icon="users" title={urlQ ? t.common.noMatches : t.users.searchFirst} />}
          />
        )}
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button size="sm" variant="secondary" icon="chevronLeft" disabled={tokens.length <= 1} onClick={() => setTokens((s) => s.slice(0, -1))}>
            {t.common.previous}
          </Button>
          <Button size="sm" variant="secondary" disabled={!page.data?.pageToken} onClick={() => setTokens((s) => [...s, page.data?.pageToken ?? null])}>
            {t.common.next}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function UsersPage() {
  return (
    <RequirePermission permission="users.read">
      <UsersInner />
    </RequirePermission>
  );
}
