'use client';

import { useRouter } from 'next/navigation';
import { RequirePermission } from '@/components/Shell';
import { LinkButton } from '@/components/forms';
import { Badge, Card, DataTable, ErrorState, PageHeader, TableSkeleton, useAsync, type Column } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { resolveText } from '@/lib/text';
import type { AdminEdit } from '@/lib/types';

function EditsInner() {
  const { t, lang, fmt, href, date } = useI18n();
  const router = useRouter();
  const list = useAsync(() => api.get<AdminEdit[]>('v1/admin/edit'), []);

  const columns: Column<AdminEdit>[] = [
    { key: 'week', header: t.edits.weekStart, sortValue: (e) => e.weekStart, render: (e) => <span className="font-medium whitespace-nowrap">{date(e.weekStart)}</span> },
    {
      key: 'title',
      header: t.edits.titleLabel,
      render: (e) => (
        <div>
          <p className="font-medium text-ink">{resolveText(e.title, lang)}</p>
          <p className="font-mono text-xs text-muted">{e.id}</p>
        </div>
      ),
    },
    {
      key: 'looks',
      header: t.edits.looks,
      sortValue: (e) => e.looks.length,
      render: (e) => <Badge tone={e.looks.length === 7 ? 'green' : 'amber'}>{fmt(t.edits.looksCount, { count: e.looks.length })}</Badge>,
    },
    {
      key: 'status',
      header: t.common.status,
      render: (e) => (
        <div className="flex flex-wrap gap-1">
          {e.retired ? <Badge>{t.common.retired}</Badge> : e.published ? <Badge tone="green">{t.edits.published}</Badge> : <Badge tone="amber">{t.edits.draft}</Badge>}
          {e.sponsored && <Badge tone="blue">{t.edits.sponsored}</Badge>}
        </div>
      ),
    },
    { key: 'updated', header: t.common.updatedAt, sortValue: (e) => e.updatedAt, render: (e) => <span className="text-muted">{date(e.updatedAt)}</span> },
  ];

  return (
    <div>
      <PageHeader
        title={t.edits.title}
        subtitle={t.edits.subtitle}
        actions={
          <LinkButton href={href('/content/edits/edit/')} icon="plus">
            {t.edits.newEdit}
          </LinkButton>
        }
      />
      <Card padded={false}>
        {list.loading ? (
          <TableSkeleton />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <DataTable columns={columns} rows={list.data ?? []} rowKey={(e) => e.id} onRowClick={(e) => router.push(href(`/content/edits/edit/?id=${encodeURIComponent(e.id)}`))} />
        )}
      </Card>
    </div>
  );
}

export default function EditsPage() {
  return (
    <RequirePermission permission="content.manage">
      <EditsInner />
    </RequirePermission>
  );
}
