'use client';

import Link from 'next/link';
import { useState } from 'react';
import { RequirePermission } from '@/components/Shell';
import { Badge, Button, Card, ConfirmModal, DataTable, EmptyState, ErrorState, Field, PageHeader, TableSkeleton, Textarea, useAsync, useToast, type Column } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { FeedUserPost } from '@/lib/types';

// Akış F2: looks users shared to the home feed that were reported or taken off the feed automatically (3 distinct
// reporters). Restore = back in the feed, reports dismissed. Remove = the look moderation of the reports queue.

type Action = { kind: 'restore' | 'remove'; post: FeedUserPost };

function FeedModerationInner() {
  const { t, fmt, href, dateTime, errorText } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const posts = useAsync(() => api.get<FeedUserPost[]>('v1/admin/feed-user-post'), []);
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const open = (kind: Action['kind'], post: FeedUserPost) => {
    setNote('');
    setAction({ kind, post });
  };

  const submit = async () => {
    if (!action) return;
    setBusy(true);
    try {
      await api.post(`v1/admin/feed-user-post/${encodeURIComponent(action.post.id)}/${action.kind}`, { note: note.trim() || null });
      toast.success(action.kind === 'restore' ? t.feedModeration.restored : t.feedModeration.removed);
    } catch (error) {
      // A 404 / 409 means the row on screen is stale (un-shared, or decided by somebody else): show the server's state.
      toast.error(errorText(error));
    } finally {
      setBusy(false);
      setAction(null);
      posts.reload();
    }
  };

  const columns: Column<FeedUserPost>[] = [
    {
      key: 'look',
      header: t.feedModeration.look,
      render: (p) => (
        <div className="flex items-center gap-3">
          {p.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imageUrl} alt="" className="h-24 w-[72px] rounded-md border border-line object-cover" />
          ) : (
            <div className="flex h-24 w-[72px] items-center justify-center rounded-md border border-line text-center text-xs text-muted">{t.feedModeration.noCover}</div>
          )}
          <div>
            <p className="font-medium">{p.lookName || t.feedModeration.untitled}</p>
            <p className="text-xs text-muted">{fmt(t.feedModeration.sharedAt, { date: dateTime(p.sharedAt) })}</p>
            <p className="text-xs text-muted">{fmt(t.feedModeration.likes, { count: p.likeCount })}</p>
            {p.involvesTeen && (
              <span className="mt-1 inline-block">
                <Badge tone="red">{t.feedModeration.involvesTeen}</Badge>
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'owner',
      header: t.feedModeration.owner,
      render: (p) =>
        p.ownerHandle ? (
          can('users.read') ? (
            <Link href={href(`/users/?q=${encodeURIComponent(`@${p.ownerHandle}`)}`)} className="font-medium text-brand-700 hover:underline">
              @{p.ownerHandle}
            </Link>
          ) : (
            <span className="font-medium">@{p.ownerHandle}</span>
          )
        ) : (
          <span className="font-mono text-xs text-muted">{p.ownerTenantId}</span>
        ),
    },
    {
      key: 'status',
      header: t.feedModeration.status,
      sortValue: (p) => p.status,
      render: (p) => <Badge tone={p.status === 'autoHidden' ? 'red' : 'amber'}>{p.status === 'autoHidden' ? t.feedModeration.autoHidden : t.feedModeration.reported}</Badge>,
    },
    { key: 'reporters', header: t.feedModeration.reporters, sortValue: (p) => p.reporterCount, render: (p) => <span className="font-medium">{p.reporterCount}</span> },
    {
      key: 'reasons',
      header: t.feedModeration.reasons,
      render: (p) => (
        <div className="flex max-w-xs flex-wrap gap-1.5">
          {p.reasons.map((r) => (
            <Badge key={r.reason} tone={r.reason === 'minorSafety' ? 'red' : 'amber'}>
              {t.enums.reportReason[r.reason]} · {r.count}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'notes',
      header: t.feedModeration.notes,
      render: (p) => {
        const notes = p.reports.filter((r) => r.note);
        return notes.length === 0 ? (
          <span className="text-xs text-muted">—</span>
        ) : (
          <ul className="max-w-xs space-y-1 text-xs text-muted">
            {notes.map((r) => (
              <li key={r.id}>{r.note}</li>
            ))}
          </ul>
        );
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t.common.actions}</span>,
      className: 'text-right',
      render: (p) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="secondary" icon="refresh" onClick={() => open('restore', p)}>
            {t.feedModeration.restore}
          </Button>
          <Button size="sm" variant="danger" icon="ban" disabled={p.reports.length === 0} onClick={() => open('remove', p)}>
            {t.feedModeration.remove}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t.feedModeration.title} subtitle={t.feedModeration.subtitle} />
      <Card padded={false}>
        {posts.loading ? (
          <TableSkeleton />
        ) : posts.error ? (
          <ErrorState error={posts.error} onRetry={posts.reload} />
        ) : (
          <DataTable columns={columns} rows={posts.data ?? []} rowKey={(p) => p.id} empty={<EmptyState icon="flag" title={t.feedModeration.empty} />} />
        )}
      </Card>
      <ConfirmModal
        open={!!action}
        title={action?.kind === 'remove' ? t.feedModeration.removeTitle : t.feedModeration.restoreTitle}
        body={action?.kind === 'remove' ? t.feedModeration.removeHint : t.feedModeration.restoreHint}
        confirmLabel={action?.kind === 'remove' ? t.feedModeration.remove : t.feedModeration.restore}
        danger={action?.kind === 'remove'}
        busy={busy}
        onClose={() => setAction(null)}
        onConfirm={() => void submit()}
      >
        <div className="mt-3">
          <Field label={t.feedModeration.note} htmlFor="feed-mod-note">
            <Textarea id="feed-mod-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </ConfirmModal>
    </div>
  );
}

export default function FeedModerationPage() {
  return (
    <RequirePermission permission="moderation.manage">
      <FeedModerationInner />
    </RequirePermission>
  );
}
