'use client';

import { DateRange, useRange } from '@/components/DateRange';
import { RequirePermission } from '@/components/Shell';
import { DailyChart } from '@/components/charts';
import { Button, Card, ErrorState, KpiTile, PageHeader, Skeleton, useAsync } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { daysBetween } from '@/lib/dates';
import { useI18n } from '@/lib/i18n';
import { downloadText, toCsv } from '@/lib/text';
import type { AdminBrand, RevenueBucket, RevenueReport } from '@/lib/types';

function BucketTable({ title, rows, label, money, number }: { title: string; rows: RevenueBucket[]; label: (k: string) => string; money: (n: number) => string; number: (n: number) => string }) {
  const { t } = useI18n();
  return (
    <Card title={title} padded={false}>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">{t.common.noResults}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-stone-50/60 text-left text-xs text-muted">
              <th className="px-5 py-2.5 font-medium">{t.revenue.key}</th>
              <th className="px-5 py-2.5 text-right font-medium">{t.revenue.conversions}</th>
              <th className="px-5 py-2.5 text-right font-medium">{t.revenue.gmv}</th>
              <th className="px-5 py-2.5 text-right font-medium">{t.revenue.commission}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-line last:border-b-0">
                <td className="px-5 py-2.5">{label(r.key)}</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{number(r.conversions)}</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{money(r.gmvMinor)}</td>
                <td className="px-5 py-2.5 text-right font-medium tabular-nums">{money(r.commissionMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function RevenueInner() {
  const { t, number, money, percent, date } = useI18n();
  const { can } = useAuth();
  const [range, setRange] = useRange(30);
  const report = useAsync(() => api.get<RevenueReport>('v1/admin/report/revenue', { query: range }), [range.from, range.to]);
  const brands = useAsync(() => (can('catalog.manage') ? api.get<AdminBrand[]>('v1/admin/brand') : Promise.resolve([] as AdminBrand[])), []);
  const r = report.data;
  const cur = (n: number) => money(n, r?.currency ?? 'TRY');
  const brandName = (id: string) => brands.data?.find((b) => b.id === id)?.name ?? id;
  const sourceName = (k: string) => (t.enums.source as Record<string, string>)[k] ?? k;
  const daily = r
    ? daysBetween(r.from, r.to).map((day) => {
        const row = r.byDay?.find((x) => x.day === day);
        return { day, clicks: row?.clicks ?? 0, conversions: row?.conversions ?? 0, gmvMinor: row?.gmvMinor ?? 0, commissionMinor: row?.commissionMinor ?? 0 };
      })
    : [];

  const exportCsv = () => {
    if (!r) return;
    const minor = (n: number) => (n / 100).toFixed(2);
    const rows: unknown[][] = [['section', 'key', 'clicks', 'conversions', 'gmv', 'commission', 'currency']];
    for (const d of daily) rows.push(['day', d.day, d.clicks, d.conversions, minor(d.gmvMinor), minor(d.commissionMinor), r.currency]);
    for (const b of r.byBrand) rows.push(['brand', b.key, '', b.conversions, minor(b.gmvMinor), minor(b.commissionMinor), r.currency]);
    for (const b of r.byNetwork ?? []) rows.push(['network', b.key, '', b.conversions, minor(b.gmvMinor), minor(b.commissionMinor), r.currency]);
    for (const b of r.bySource) rows.push(['source', b.key, '', b.conversions, minor(b.gmvMinor), minor(b.commissionMinor), r.currency]);
    for (const b of r.byLook) rows.push(['look', b.key, '', b.conversions, minor(b.gmvMinor), minor(b.commissionMinor), r.currency]);
    rows.push(['total', '', r.clicks ?? '', r.conversions, minor(r.gmvMinor), minor(r.commissionMinor), r.currency]);
    downloadText(`droblet-revenue-${r.from}_${r.to}.csv`, toCsv(rows));
  };

  return (
    <div>
      <PageHeader
        title={t.revenue.title}
        subtitle={t.revenue.subtitle}
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[118px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile icon="external" tone="blue" label={t.revenue.clicks} value={number(r.clicks ?? 0)} />
            <KpiTile
              icon="check"
              tone="green"
              label={t.revenue.conversions}
              value={number(r.conversions)}
              sub={`${t.revenue.pending} ${r.pending} · ${t.revenue.approved} ${r.approved} · ${t.revenue.rejected} ${r.rejected}`}
            />
            <KpiTile icon="trending" label={t.revenue.gmv} value={cur(r.gmvMinor)} sub={r.clicks ? `${t.revenue.conversionRate}: ${percent(r.conversions / r.clicks)}` : undefined} />
            <KpiTile icon="sparkle" tone="amber" label={t.revenue.commission} value={cur(r.commissionMinor)} />
          </div>
          <Card title={t.revenue.byDay}>
            <DailyChart days={daily.map((d) => ({ day: d.day, bar: d.clicks, line: d.conversions }))} label={t.revenue.byDay} barLabel={t.revenue.clicks} lineLabel={t.revenue.conversions} />
          </Card>
          <div className="grid gap-4 xl:grid-cols-2">
            <BucketTable title={t.revenue.byBrand} rows={r.byBrand} label={brandName} money={cur} number={number} />
            <BucketTable title={t.revenue.byNetwork} rows={r.byNetwork ?? []} label={sourceName} money={cur} number={number} />
            <BucketTable title={t.revenue.bySource} rows={r.bySource} label={sourceName} money={cur} number={number} />
            <BucketTable title={t.revenue.byLook} rows={r.byLook} label={(k) => k} money={cur} number={number} />
          </div>
          <Card title={t.revenue.byDay} padded={false}>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-stone-50">
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-5 py-2.5 font-medium">{t.revenue.day}</th>
                    <th className="px-5 py-2.5 text-right font-medium">{t.revenue.clicks}</th>
                    <th className="px-5 py-2.5 text-right font-medium">{t.revenue.conversions}</th>
                    <th className="px-5 py-2.5 text-right font-medium">{t.revenue.gmv}</th>
                    <th className="px-5 py-2.5 text-right font-medium">{t.revenue.commission}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...daily].reverse().map((d) => (
                    <tr key={d.day} className="border-b border-line last:border-b-0">
                      <td className="px-5 py-2 whitespace-nowrap">{date(d.day)}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{d.clicks}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{d.conversions}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{cur(d.gmvMinor)}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{cur(d.commissionMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function RevenuePage() {
  return (
    <RequirePermission permission="analytics.view">
      <RevenueInner />
    </RequirePermission>
  );
}
