'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { RequirePermission } from '@/components/Shell';
import { FallbackBanner } from '@/components/ai';
import { Badge, Card, DataTable, ErrorState, Input, PageHeader, TableSkeleton, useAsync, type Column } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { AiPromptSummary } from '@/lib/types';

const FEATURES = ['stylist', 'wardrobe', 'outfit_import', 'palette', 'tryon', 'cleanup', 'look', 'common'] as const;

function PromptsInner() {
  const { t, fmt, href, dateTime } = useI18n();
  const list = useAsync(() => api.get<{ items: AiPromptSummary[] }>('v1/admin/ai/prompt'), []);
  const [query, setQuery] = useState('');

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list.data?.items ?? []).filter((p) => !q || p.key.includes(q) || p.description.toLowerCase().includes(q));
  }, [list.data, query]);

  const columns: Column<AiPromptSummary>[] = [
    {
      key: 'key',
      header: t.ai.key,
      render: (p) => (
        <Link href={href(`/ai/prompts/edit/?key=${encodeURIComponent(p.key)}`)} className="font-mono text-[13px] font-medium text-brand-700 hover:underline">
          {p.key}
        </Link>
      ),
      sortValue: (p) => p.key,
    },
    {
      key: 'description',
      header: t.ai.description,
      render: (p) => (
        <div className="max-w-xl">
          <p className="text-[13px] text-ink">{p.description}</p>
          <p className="mt-0.5 text-xs text-muted">
            {t.ai.kinds[p.kind]} · <span className="font-mono">{p.operation}</span>
          </p>
        </div>
      ),
    },
    {
      key: 'live',
      header: t.ai.live,
      render: (p) => (
        <div className="flex flex-wrap gap-1">
          {!p.editable ? (
            <Badge>{t.ai.viewOnly}</Badge>
          ) : p.overridden ? (
            <Badge tone="brand">{fmt(t.ai.overridden, { version: p.publishedVersion })}</Badge>
          ) : (
            <Badge>{p.publishedVersion ? fmt(t.ai.codeDefaultVersion, { version: p.publishedVersion }) : t.ai.codeDefault}</Badge>
          )}
          {p.hasDraft && <Badge tone="amber">{t.ai.draft}</Badge>}
          {p.fallback && !p.fallback.acknowledged && <Badge tone="red">{t.ai.fallbackShort}</Badge>}
        </div>
      ),
      sortValue: (p) => p.publishedVersion,
    },
    {
      key: 'editor',
      header: t.ai.lastEditor,
      render: (p) => <span className="text-xs text-muted">{p.publishedBy ?? (p.publishedAt ? t.ai.system : '—')}</span>,
    },
    { key: 'date', header: t.ai.date, render: (p) => <span className="whitespace-nowrap text-xs text-muted">{dateTime(p.publishedAt)}</span>, sortValue: (p) => p.publishedAt ?? '' },
  ];

  const alerts = (list.data?.items ?? []).filter((p) => p.fallback && !p.fallback.acknowledged);

  return (
    <div>
      <PageHeader title={t.ai.promptsTitle} subtitle={t.ai.promptsSubtitle} />
      {alerts.map((p) => (
        <FallbackBanner key={p.key} prompt={p} onAcknowledged={() => list.reload()} />
      ))}
      <div className="mb-4 max-w-sm">
        <Input type="search" placeholder={t.ai.searchPlaceholder} aria-label={t.ai.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {list.error ? (
        <Card>
          <ErrorState error={list.error} onRetry={list.reload} />
        </Card>
      ) : !list.data ? (
        <Card padded={false}>
          <TableSkeleton rows={8} cols={5} />
        </Card>
      ) : (
        <div className="space-y-4">
          {FEATURES.map((feature) => {
            const rows = items.filter((p) => p.feature === feature);
            if (!rows.length) return null;
            return (
              <Card key={feature} title={t.ai.features[feature]} subtitle={fmt(t.ai.promptCount, { count: rows.length })} padded={false}>
                <DataTable columns={columns} rows={rows} rowKey={(p) => p.key} />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AiPromptsPage() {
  return (
    <RequirePermission permission="ai.manage">
      <PromptsInner />
    </RequirePermission>
  );
}
