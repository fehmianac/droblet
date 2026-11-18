'use client';

import { DateRange, useRange } from '@/components/DateRange';
import { RequirePermission } from '@/components/Shell';
import { FunnelChart } from '@/components/charts';
import { Button, Card, ErrorState, KpiTile, PageHeader, Skeleton, useAsync } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { downloadText, toCsv } from '@/lib/text';
import type { FunnelReport } from '@/lib/types';

function FunnelInner() {
  const { t, number, percent } = useI18n();
  const [range, setRange] = useRange(30);
  const report = useAsync(() => api.get<FunnelReport>('v1/admin/report/funnel', { query: range }), [range.from, range.to]);
  const r = report.data;
  const stepName = (n: string) => (t.funnel.steps as Record<string, string>)[n] ?? n;

  const exportCsv = () => {
    if (!r) return;
    downloadText(
      `droblet-funnel-${r.from}_${r.to}.csv`,
      toCsv([['step', 'events', 'actors', 'rateFromPrevious', 'rateFromFirst'], ...r.steps.map((s) => [s.name, s.events, s.actors, s.rateFromPrevious ?? '', s.rateFromFirst ?? ''])]),
    );
  };

  return (
    <div>
      <PageHeader
        title={t.funnel.title}
        subtitle={t.funnel.subtitle}
        actions={
          <Button variant="secondary" icon="download" disabled={!r} onClick={exportCsv}>
            {t.common.exportCsv}
          </Button>
        }
      />
      <Card className="mb-4">
        <DateRange value={range} onChange={setRange} />
      </Card>
      {report.error ? (
        <Card>
          <ErrorState error={report.error} onRetry={report.reload} />
        </Card>
      ) : !r ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <KpiTile icon="list" label={t.funnel.totalEvents} value={number(r.totalEvents)} />
            <KpiTile icon="users" tone="blue" label={t.funnel.totalActors} value={number(r.totalActors)} />
          </div>
          <Card title={t.funnel.title}>
            <FunnelChart label={t.funnel.title} steps={r.steps.map((s) => ({ name: stepName(s.name), value: s.actors, rate: s.rateFromFirst === null ? '' : percent(s.rateFromFirst) }))} />
          </Card>
          <Card padded={false}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-stone-50/60 text-left text-xs text-muted">
                  <th className="px-5 py-2.5 font-medium">{t.funnel.step}</th>
                  <th className="px-5 py-2.5 text-right font-medium">{t.funnel.events}</th>
                  <th className="px-5 py-2.5 text-right font-medium">{t.funnel.actors}</th>
                  <th className="px-5 py-2.5 text-right font-medium">{t.funnel.fromPrevious}</th>
                  <th className="px-5 py-2.5 text-right font-medium">{t.funnel.fromFirst}</th>
                </tr>
              </thead>
              <tbody>
                {r.steps.map((s) => (
                  <tr key={s.name} className="border-b border-line last:border-b-0">
                    <td className="px-5 py-2.5">
                      {stepName(s.name)} <span className="font-mono text-xs text-muted">{s.name}</span>
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{number(s.events)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{number(s.actors)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{percent(s.rateFromPrevious)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{percent(s.rateFromFirst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function FunnelPage() {
  return (
    <RequirePermission permission="analytics.view">
      <FunnelInner />
    </RequirePermission>
  );
}
