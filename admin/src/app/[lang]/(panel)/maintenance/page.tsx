'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequirePermission } from '@/components/Shell';
import { Icon } from '@/components/icons';
import { Badge, Button, Card, ConfirmModal, DataTable, EmptyState, ErrorState, PageHeader, TableSkeleton, useToast, type Column } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ACTIVE_MAINTENANCE_STATUSES, type MaintenanceRun, type MaintenanceRunStatus } from '@/lib/types';

const BASE = 'v1/admin/maintenance/publish-item-images';
const POLL_MS = 3000;

const isActive = (status: MaintenanceRunStatus) => ACTIVE_MAINTENANCE_STATUSES.includes(status);
const statusTone = (status: MaintenanceRunStatus) =>
  status === 'completed' ? 'green' : status === 'failed' ? 'red' : status === 'cancelled' ? 'neutral' : status === 'cancelling' ? 'amber' : 'blue';

/** Newest first, the updated run replacing its old copy (or prepended when new). */
function upsert(list: MaintenanceRun[], run: MaintenanceRun): MaintenanceRun[] {
  const rest = list.filter((r) => r.id !== run.id);
  return [run, ...rest].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}

function StatusBadge({ status }: { status: MaintenanceRunStatus }) {
  const { t } = useI18n();
  return <Badge tone={statusTone(status)}>{t.maintenance.publishImages.status[status]}</Badge>;
}

function Counters({ run }: { run: MaintenanceRun }) {
  const { t, number } = useI18n();
  const c = t.maintenance.publishImages.counters;
  const items: [string, number, string?][] = [
    [c.tenants, run.tenants],
    [c.scanned, run.scanned],
    [run.dryRun ? c.wouldPublish : c.published, run.published, 'text-emerald-700'],
    [c.alreadyPublic, run.alreadyPublic],
    [c.skipped, run.skipped],
    [c.hidden, run.hidden],
    [run.dryRun ? c.wouldMake : c.renditionsMade, run.renditionsMade],
    [c.failed, run.failed, run.failed > 0 ? 'text-red-700' : undefined],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, value, tone]) => (
        <div key={label} className="rounded-lg border border-line px-4 py-3">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? 'text-ink'}`}>{number(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function MaintenanceInner() {
  const { t, fmt, number, dateTime, errorText } = useI18n();
  const toast = useToast();
  const m = t.maintenance.publishImages;

  const [runs, setRuns] = useState<MaintenanceRun[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'dry' | 'start' | 'cancel' | 'retry' | null>(null);
  const [confirm, setConfirm] = useState<'start' | 'cancel' | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pollTick, setPollTick] = useState(0);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await api.get<{ runs: MaintenanceRun[] }>(BASE);
      setRuns(res.runs);
    } catch (error) {
      setLoadError(error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = runs?.find((r) => isActive(r.status)) ?? null;
  const selected = runs?.find((r) => r.id === selectedId) ?? runs?.[0] ?? null;

  // Live progress: poll the active run every 3 s; stops once it has finished.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const next = await api.get<MaintenanceRun>(`${BASE}/${encodeURIComponent(active.id)}`);
        if (!cancelled) setRuns((list) => upsert(list ?? [], next));
      } catch (error) {
        if (cancelled) return;
        // A 404 means the run is gone: reload the list. Anything else (a network blip): try again on the next tick.
        if (error instanceof ApiError && error.status === 404) void load();
        else setPollTick((x) => x + 1);
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, pollTick, load]);

  const refused = (error: unknown) => {
    const text = errorText(error);
    toast.error(text);
    if (error instanceof ApiError && error.status === 409) {
      setRefusal(text);
      // Someone else may have started a run, or this one may have finished meanwhile.
      void load();
    }
  };

  const start = async (dryRun: boolean) => {
    setBusy(dryRun ? 'dry' : 'start');
    setRefusal(null);
    try {
      const run = await api.post<MaintenanceRun>(BASE, { dryRun });
      setRuns((list) => upsert(list ?? [], run));
      setSelectedId(run.id);
      toast.success(m.started);
    } catch (error) {
      refused(error);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const cancelRun = async (run: MaintenanceRun) => {
    setBusy('cancel');
    setRefusal(null);
    try {
      const next = await api.post<MaintenanceRun>(`${BASE}/${encodeURIComponent(run.id)}/cancel`);
      setRuns((list) => upsert(list ?? [], next));
      toast.info(m.cancelRequested);
    } catch (error) {
      refused(error);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const retryFailed = async (run: MaintenanceRun) => {
    setBusy('retry');
    setRefusal(null);
    try {
      const next = await api.post<MaintenanceRun>(`${BASE}/${encodeURIComponent(run.id)}/retry-failed`);
      setRuns((list) => upsert(list ?? [], next));
      setSelectedId(next.id);
      toast.success(m.retryStarted);
    } catch (error) {
      refused(error);
    } finally {
      setBusy(null);
    }
  };

  const failedCols: Column<MaintenanceRun['failedItems'][number]>[] = [
    { key: 'tenant', header: m.tenantId, sortValue: (f) => f.tenantId, render: (f) => <span className="font-mono text-xs">{f.tenantId}</span> },
    { key: 'item', header: m.itemId, sortValue: (f) => f.itemId, render: (f) => <span className="font-mono text-xs">{f.itemId}</span> },
    { key: 'reason', header: m.reason, sortValue: (f) => f.reason, render: (f) => <Badge tone="red">{m.failReasons[f.reason] ?? f.reason}</Badge> },
  ];

  const historyCols: Column<MaintenanceRun>[] = [
    { key: 'started', header: m.startedAt, sortValue: (r) => r.startedAt, render: (r) => <span className="whitespace-nowrap">{dateTime(r.startedAt)}</span> },
    { key: 'by', header: m.startedBy, render: (r) => <span className="text-xs">{r.startedBy.email}</span> },
    {
      key: 'dry',
      header: m.dryRunColumn,
      render: (r) => (r.dryRun ? <Badge tone="brand">{t.common.yes}</Badge> : <span className="text-muted">{t.common.no}</span>),
    },
    {
      key: 'status',
      header: t.common.status,
      sortValue: (r) => r.status,
      render: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <StatusBadge status={r.status} />
          {r.retryOf && <Icon name="refresh" className="h-3.5 w-3.5 text-muted" />}
        </span>
      ),
    },
    { key: 'scanned', header: m.counters.scanned, className: 'text-right', render: (r) => <span className="tabular-nums">{number(r.scanned)}</span> },
    {
      key: 'published',
      header: `${m.counters.published} / ${m.counters.wouldPublish}`,
      className: 'text-right',
      render: (r) => <span className="tabular-nums">{number(r.published)}</span>,
    },
    { key: 'already', header: m.counters.alreadyPublic, className: 'text-right', render: (r) => <span className="tabular-nums">{number(r.alreadyPublic)}</span> },
    { key: 'skipped', header: m.counters.skipped, className: 'text-right', render: (r) => <span className="tabular-nums">{number(r.skipped)}</span> },
    {
      key: 'failed',
      header: m.counters.failed,
      className: 'text-right',
      render: (r) => <span className={`tabular-nums ${r.failed ? 'text-red-700' : ''}`}>{number(r.failed)}</span>,
    },
    { key: 'finished', header: m.finishedAt, sortValue: (r) => r.finishedAt ?? '', render: (r) => <span className="whitespace-nowrap">{dateTime(r.finishedAt)}</span> },
  ];

  const blocked = !runs || !!active || busy !== null;

  return (
    <div>
      <PageHeader title={t.maintenance.title} subtitle={t.maintenance.subtitle} />

      <Card
        title={m.title}
        actions={
          <>
            <Button variant="secondary" icon="eye" loading={busy === 'dry'} disabled={blocked} onClick={() => void start(true)}>
              {m.dryRun}
            </Button>
            <Button icon="upload" disabled={blocked} onClick={() => setConfirm('start')}>
              {m.start}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-muted">
          <p>{m.body}</p>
          <p className="flex items-start gap-2">
            <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>{m.safe}</span>
          </p>
          <p className="text-xs">{m.dryRunHint}</p>
        </div>
        {active && (
          <p className="mt-4 flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800" role="status">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
            {m.activeNote}
          </p>
        )}
        {refusal && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {refusal}
          </p>
        )}
      </Card>

      {loadError ? (
        <Card className="mt-4">
          <ErrorState error={loadError} onRetry={() => void load()} />
        </Card>
      ) : !runs ? (
        <Card className="mt-4" padded={false}>
          <TableSkeleton rows={4} />
        </Card>
      ) : !selected ? (
        <Card className="mt-4">
          <EmptyState icon="image" title={m.noRuns} />
        </Card>
      ) : (
        <>
          <Card
            className="mt-4"
            title={
              <span className="inline-flex flex-wrap items-center gap-2">
                {m.selected}
                <StatusBadge status={selected.status} />
                {selected.dryRun && <Badge tone="brand">{m.dryRun}</Badge>}
              </span>
            }
            subtitle={
              <>
                <span className="font-mono">{selected.id}</span> · {dateTime(selected.startedAt)} · {selected.startedBy.email}
                {selected.retryOf && (
                  <>
                    {' · '}
                    {fmt(m.retryOf, { id: selected.retryOf })}
                    {selected.onlyItemCount !== null && ` (${fmt(m.onlyItems, { count: number(selected.onlyItemCount) })})`}
                  </>
                )}
              </>
            }
            actions={
              isActive(selected.status) && selected.status !== 'cancelling' ? (
                <Button variant="danger" size="sm" icon="ban" disabled={busy !== null} onClick={() => setConfirm('cancel')}>
                  {m.cancel}
                </Button>
              ) : undefined
            }
          >
            <Counters run={selected} />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>{fmt(m.lastUpdate, { time: dateTime(selected.updatedAt) })}</span>
              {selected.finishedAt && (
                <span>
                  {m.finishedAt}: {dateTime(selected.finishedAt)}
                </span>
              )}
              {selected.cancelRequestedAt && (
                <span>
                  {m.cancelRequestedAt}: {dateTime(selected.cancelRequestedAt)}
                </span>
              )}
              {isActive(selected.status) && <span>{m.live}</span>}
            </div>

            {selected.skipReasons.length > 0 && (
              <div className="mt-5">
                <h3 className="text-sm font-semibold text-ink">{m.skipReasons}</h3>
                <ul className="mt-2 divide-y divide-line rounded-lg border border-line text-sm">
                  {selected.skipReasons.map((s) => (
                    <li key={s.reason} className="flex items-center justify-between gap-3 px-4 py-2">
                      <span>
                        {m.reasons[s.reason] ?? s.reason} <span className="font-mono text-xs text-muted">{s.reason}</span>
                      </span>
                      <span className="tabular-nums">{number(s.count)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 flex items-start gap-2 text-xs text-muted">
                  <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {m.skipNote}
                </p>
              </div>
            )}
          </Card>

          <Card
            className="mt-4"
            title={m.failedItems}
            subtitle={
              selected.failed > selected.failedItems.length
                ? fmt(m.failedTruncated, { shown: number(selected.failedItems.length), total: number(selected.failed) })
                : undefined
            }
            padded={false}
            actions={
              selected.failed > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon="refresh"
                  loading={busy === 'retry'}
                  disabled={blocked || isActive(selected.status)}
                  onClick={() => void retryFailed(selected)}
                >
                  {m.retryFailed}
                </Button>
              ) : undefined
            }
          >
            <DataTable
              columns={failedCols}
              rows={selected.failedItems}
              rowKey={(f) => `${f.tenantId}/${f.itemId}`}
              empty={<EmptyState icon="check" title={m.noFailed} />}
            />
          </Card>

          <Card className="mt-4" title={m.history} subtitle={m.historyHint} padded={false}>
            <DataTable
              columns={historyCols}
              rows={runs}
              rowKey={(r) => r.id}
              selected={new Set([selected.id])}
              onRowClick={(r) => setSelectedId(r.id)}
            />
          </Card>
        </>
      )}

      <ConfirmModal
        open={confirm === 'start'}
        title={m.startConfirmTitle}
        body={m.startConfirmBody}
        confirmLabel={m.start}
        busy={busy === 'start'}
        onClose={() => setConfirm(null)}
        onConfirm={() => void start(false)}
      />
      <ConfirmModal
        open={confirm === 'cancel'}
        title={m.cancelConfirmTitle}
        body={m.cancelConfirmBody}
        confirmLabel={m.cancel}
        danger
        busy={busy === 'cancel'}
        onClose={() => setConfirm(null)}
        onConfirm={() => selected && void cancelRun(selected)}
      />
    </div>
  );
}

export default function MaintenancePage() {
  return (
    <RequirePermission permission="maintenance.manage">
      <MaintenanceInner />
    </RequirePermission>
  );
}
