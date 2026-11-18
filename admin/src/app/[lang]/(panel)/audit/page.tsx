'use client';

import { useState } from 'react';
import { RequirePermission } from '@/components/Shell';
import { Badge, Button, Card, DataTable, Drawer, EmptyState, ErrorState, Input, PageHeader, Select, TableSkeleton, useAsync, type Column } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { AdminUser, AuditEntry, Paged } from '@/lib/types';

function pretty(json: string | null): string {
  if (!json) return '—';
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

function AuditInner() {
  const { t, dateTime } = useI18n();
  const admins = useAsync(() => api.get<AdminUser[]>('v1/admin/admin-user').catch(() => [] as AdminUser[]), []);
  const [filters, setFilters] = useState({ adminId: '', action: '', targetType: '' });
  const [draft, setDraft] = useState(filters);
  const [tokens, setTokens] = useState<(string | null)[]>([null]);
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const pageToken = tokens[tokens.length - 1] ?? null;
  const page = useAsync(() => api.get<Paged<AuditEntry>>('v1/admin/audit', { query: { ...filters, pageToken, limit: 50 } }), [filters, pageToken]);

  const columns: Column<AuditEntry>[] = [
    { key: 'at', header: t.audit.at, render: (e) => <span className="whitespace-nowrap text-muted">{dateTime(e.at)}</span> },
    { key: 'admin', header: t.audit.admin, render: (e) => e.adminEmail ?? <span className="font-mono text-xs">{e.adminId}</span> },
    { key: 'action', header: t.audit.action, render: (e) => <Badge tone={e.action.startsWith('auth.') ? 'neutral' : e.action.startsWith('user.') ? 'amber' : 'brand'}>{e.action}</Badge> },
    { key: 'target', header: t.audit.target, render: (e) => (e.targetType ? <span className="text-xs">{e.targetType} · <span className="font-mono">{e.targetId}</span></span> : '—') },
    { key: 'ip', header: t.audit.ip, render: (e) => <span className="font-mono text-xs text-muted">{e.ip ?? '—'}</span> },
  ];

  return (
    <div>
      <PageHeader title={t.audit.title} subtitle={t.audit.subtitle} />
      <Card padded={false}>
        <form
          className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            setTokens([null]);
            setFilters(draft);
          }}
        >
          <Select aria-label={t.audit.admin} value={draft.adminId} onChange={(e) => setDraft({ ...draft, adminId: e.target.value })} className="w-56">
            <option value="">{t.audit.allAdmins}</option>
            {(admins.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </Select>
          <Input aria-label={t.audit.action} placeholder={t.audit.actionFilter} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} className="w-56" />
          <Input aria-label={t.audit.targetFilter} placeholder={t.audit.targetFilter} value={draft.targetType} onChange={(e) => setDraft({ ...draft, targetType: e.target.value })} className="w-44" />
          <Button type="submit" variant="secondary" icon="funnel">
            {t.common.filter}
          </Button>
        </form>
        {page.loading ? (
          <TableSkeleton rows={10} />
        ) : page.error ? (
          <ErrorState error={page.error} onRetry={page.reload} />
        ) : (
          <DataTable columns={columns} rows={page.data?.items ?? []} rowKey={(e) => e.id} onRowClick={setOpen} empty={<EmptyState icon="list" title={t.common.noMatches} />} />
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
      <Drawer open={!!open} title={t.audit.entry} onClose={() => setOpen(null)} wide>
        {open && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2">
              <dt className="text-muted">{t.audit.at}</dt>
              <dd>{dateTime(open.at)}</dd>
              <dt className="text-muted">{t.audit.admin}</dt>
              <dd>{open.adminEmail ?? open.adminId}</dd>
              <dt className="text-muted">{t.audit.action}</dt>
              <dd className="font-mono">{open.action}</dd>
              <dt className="text-muted">{t.audit.target}</dt>
              <dd className="font-mono">{open.targetType ? `${open.targetType} / ${open.targetId}` : '—'}</dd>
              <dt className="text-muted">{t.audit.ip}</dt>
              <dd className="font-mono">{open.ip ?? '—'}</dd>
            </dl>
            <div className="grid gap-3 lg:grid-cols-2">
              {(['before', 'after'] as const).map((k) => (
                <div key={k}>
                  <p className="mb-1 text-xs font-medium text-muted">{t.audit[k]}</p>
                  <pre className="max-h-96 overflow-auto rounded-lg bg-side-800 p-3 font-mono text-xs leading-relaxed text-stone-100">{pretty(open[k])}</pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

export default function AuditPage() {
  return (
    <RequirePermission permission="audit.view">
      <AuditInner />
    </RequirePermission>
  );
}
