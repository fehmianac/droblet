'use client';

import Link from 'next/link';
import { useState } from 'react';
import { RequirePermission } from '@/components/Shell';
import { Badge, Button, Card, ConfirmModal, DataTable, EmptyState, ErrorState, Field, PageHeader, Select, TableSkeleton, Tabs, Textarea, useAsync, useToast, type Column } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { ModerationReport, Paged, ReportResolution, ReportStatus } from '@/lib/types';

type Action = { kind: 'dismiss' | 'resolve' | 'block'; report: ModerationReport };

function ModerationInner() {
  const { t, fmt, href, dateTime, errorText } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<ReportStatus>('open');
  const [tokens, setTokens] = useState<(string | null)[]>([null]);
  const pageToken = tokens[tokens.length - 1] ?? null;
  const page = useAsync(() => api.get<Paged<ModerationReport>>('v1/admin/moderation/report', { query: { status, pageToken, limit: 25 } }), [status, pageToken]);
  const [action, setAction] = useState<Action | null>(null);
  const [resolution, setResolution] = useState<ReportResolution>('contentRemoved');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const open = (kind: Action['kind'], report: ModerationReport) => {
    setNote('');
    setResolution('contentRemoved');
    setAction({ kind, report });
  };

  const submit = async () => {
    if (!action) return;
    const res: ReportResolution = action.kind === 'dismiss' ? 'dismissed' : action.kind === 'block' ? 'userSuspended' : resolution;
    setBusy(true);
    try {
      await api.post(`v1/admin/moderation/report/${encodeURIComponent(action.report.id)}/resolve`, { resolution: res, note: note.trim() || null });
      toast.success(t.common.saved);
      setAction(null);
      page.reload();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const who = (handle: string | null, tenantId: string | null) =>
    handle ? (
      can('users.read') ? (
        <Link href={href(`/users/?q=${encodeURIComponent(`@${handle}`)}`)} className="font-medium text-brand-700 hover:underline">
          @{handle}
        </Link>
      ) : (
        <span className="font-medium">@{handle}</span>
      )
    ) : (
      <span className="font-mono text-xs text-muted">{tenantId ?? t.moderation.anonymous}</span>
    );

  const columns: Column<ModerationReport>[] = [
    { key: 'created', header: t.common.createdAt, sortValue: (r) => r.createdAt, render: (r) => <span className="whitespace-nowrap text-muted">{dateTime(r.createdAt)}</span> },
    {
      key: 'target',
      header: t.moderation.target,
      render: (r) => (
        <div>
          {who(r.targetHandle, r.targetTenantId)}
          <p className="text-xs text-muted">
            {t.enums.targetKind[r.targetKind]} · <span className="font-mono">{r.targetId}</span>
          </p>
        </div>
      ),
    },
    { key: 'reason', header: t.moderation.reason, sortValue: (r) => r.reason, render: (r) => <Badge tone={r.reason === 'minorSafety' ? 'red' : 'amber'}>{t.enums.reportReason[r.reason]}</Badge> },
    { key: 'note', header: t.moderation.note, render: (r) => <p className="max-w-xs text-xs text-muted">{r.note || '—'}</p> },
    { key: 'reporter', header: t.moderation.reporter, render: (r) => who(r.reporterHandle, r.reporterTenantId) },
    status === 'open'
      ? {
          key: 'actions',
          header: <span className="sr-only">{t.common.actions}</span>,
          className: 'text-right',
          render: (r) => (
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => open('dismiss', r)}>
                {t.moderation.dismiss}
              </Button>
              <Button size="sm" variant="subtle" onClick={() => open('resolve', r)}>
                {t.moderation.resolve}
              </Button>
              <Button size="sm" variant="danger" icon="ban" onClick={() => open('block', r)}>
                {t.moderation.block}
              </Button>
            </div>
          ),
        }
      : {
          key: 'resolution',
          header: t.moderation.resolution,
          render: (r) => (
            <div>
              {r.resolution && <Badge tone={r.resolution === 'userSuspended' ? 'red' : 'neutral'}>{t.enums.resolution[r.resolution]}</Badge>}
              <p className="mt-1 text-xs text-muted">{fmt(t.moderation.resolvedAt, { date: dateTime(r.resolvedAt) })}</p>
              {r.resolutionNote && <p className="text-xs text-muted">{r.resolutionNote}</p>}
            </div>
          ),
        },
  ];

  return (
    <div>
      <PageHeader title={t.moderation.title} subtitle={t.moderation.subtitle} />
      <Card padded={false}>
        <div className="px-5 pt-2">
          <Tabs
            label={t.common.status}
            value={status}
            onChange={(s) => {
              setStatus(s);
              setTokens([null]);
            }}
            tabs={[
              { id: 'open', label: t.moderation.open },
              { id: 'resolved', label: t.moderation.resolved },
            ]}
          />
        </div>
        {page.loading ? (
          <TableSkeleton />
        ) : page.error ? (
          <ErrorState error={page.error} onRetry={page.reload} />
        ) : (
          <DataTable columns={columns} rows={page.data?.items ?? []} rowKey={(r) => r.id} empty={<EmptyState icon="flag" title={t.moderation.empty} />} />
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
      <ConfirmModal
        open={!!action}
        title={action?.kind === 'block' ? t.moderation.blockTitle : action?.kind === 'resolve' ? t.moderation.resolveTitle : t.moderation.dismiss}
        body={action?.kind === 'block' ? t.moderation.blockHint : undefined}
        confirmLabel={action?.kind === 'block' ? t.moderation.block : action?.kind === 'resolve' ? t.moderation.resolve : t.moderation.dismiss}
        danger={action?.kind === 'block'}
        busy={busy}
        onClose={() => setAction(null)}
        onConfirm={() => void submit()}
      >
        <div className="mt-3 space-y-3">
          {action?.kind === 'resolve' && (
            <Field label={t.moderation.resolution} htmlFor="mod-res">
              <Select id="mod-res" value={resolution} onChange={(e) => setResolution(e.target.value as ReportResolution)}>
                <option value="contentRemoved">{t.enums.resolution.contentRemoved}</option>
                <option value="userWarned">{t.enums.resolution.userWarned}</option>
              </Select>
            </Field>
          )}
          <Field label={t.moderation.resolutionNote} htmlFor="mod-note">
            <Textarea id="mod-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </ConfirmModal>
    </div>
  );
}

export default function ModerationPage() {
  return (
    <RequirePermission permission="moderation.manage">
      <ModerationInner />
    </RequirePermission>
  );
}
