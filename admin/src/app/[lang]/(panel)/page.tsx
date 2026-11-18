'use client';

import { BarList, DailyChart, FunnelChart } from '@/components/charts';
import { LinkButton } from '@/components/forms';
import { Card, ErrorState, KpiTile, PageHeader, Skeleton, useAsync } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { daysBetween, lastDays } from '@/lib/dates';
import { useI18n } from '@/lib/i18n';
import type { AdminBrand, Dashboard, FunnelReport, RevenueReport } from '@/lib/types';

export default function DashboardPage() {
  const { t, fmt, href, number, money, percent } = useI18n();
  const { can } = useAuth();
  const analytics = can('analytics.view');
  const range = lastDays(30);

  const dash = useAsync(() => api.get<Dashboard>('v1/admin/dashboard'), []);
  const reports = useAsync(async () => {
    if (!analytics) return null;
    const [revenue, funnel, brands] = await Promise.all([
      api.get<RevenueReport>('v1/admin/report/revenue', { query: range }),
      api.get<FunnelReport>('v1/admin/report/funnel', { query: range }),
      can('catalog.manage') ? api.get<AdminBrand[]>('v1/admin/brand') : Promise.resolve([] as AdminBrand[]),
    ]);
    return { revenue, funnel, brands };
  }, [analytics]);

  const d = dash.data;
  const rev = reports.data?.revenue;
  const brandName = (id: string) => reports.data?.brands.find((b) => b.id === id)?.name ?? id;
  const daily = rev
    ? daysBetween(rev.from, rev.to).map((day) => {
        const row = rev.byDay?.find((x) => x.day === day);
        return { day, bar: row?.clicks ?? 0, line: row?.conversions ?? 0 };
      })
    : [];
  const steps = (reports.data?.funnel.steps ?? []).map((s) => ({
    name: (t.funnel.steps as Record<string, string>)[s.name] ?? s.name,
    value: s.actors,
    rate: s.rateFromFirst === null ? '' : percent(s.rateFromFirst),
  }));

  return (
    <div>
      <PageHeader title={t.dashboard.title} subtitle={t.dashboard.subtitle} />
      {dash.error ? (
        <Card>
          <ErrorState error={dash.error} onRetry={dash.reload} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {!d ? (
            Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-xl" />)
          ) : (
            <>
              <KpiTile icon="users" label={t.dashboard.users} value={number(d.users.total)} sub={`${t.dashboard.newUsers7}: ${number(d.users.last7Days)} · ${t.dashboard.suspended}: ${number(d.users.suspended)}`} />
              <KpiTile icon="package" tone="blue" label={t.dashboard.products} value={number(d.catalog.activeProducts)} sub={`${fmt(t.dashboard.productsOf, { total: number(d.catalog.products) })} · ${t.dashboard.brands}: ${number(d.catalog.brands)}`} />
              <KpiTile icon="calendar" tone="green" label={t.dashboard.edits} value={number(d.content.publishedEdits)} sub={`${fmt(t.dashboard.editsOf, { total: number(d.content.edits) })} · ${t.dashboard.library}: ${number(d.content.libraryItems)}`} />
              <KpiTile icon="flag" tone={d.moderation.openReports > 0 ? 'red' : 'amber'} label={t.dashboard.openReports} value={number(d.moderation.openReports)} sub={`${t.dashboard.collections}: ${number(d.content.collections)}`} />
            </>
          )}
        </div>
      )}

      {analytics ? (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {!rev ? (
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-xl" />)
            ) : (
              <>
                <KpiTile icon="external" tone="blue" label={t.dashboard.clicks} value={number(rev.clicks ?? 0)} />
                <KpiTile icon="check" tone="green" label={t.dashboard.conversions} value={number(rev.conversions)} sub={rev.clicks ? `${t.revenue.conversionRate}: ${percent(rev.conversions / rev.clicks)}` : undefined} />
                <KpiTile icon="trending" label={t.dashboard.gmv} value={money(rev.gmvMinor, rev.currency)} />
                <KpiTile icon="sparkle" tone="amber" label={t.dashboard.commission} value={money(rev.commissionMinor, rev.currency)} />
              </>
            )}
          </div>
          {reports.error ? (
            <Card className="mt-4">
              <ErrorState error={reports.error} onRetry={reports.reload} />
            </Card>
          ) : (
            <div className="mt-4 grid gap-4 xl:grid-cols-3">
              <Card title={t.dashboard.revenueByDay} className="xl:col-span-2">
                {rev ? <DailyChart days={daily} label={t.dashboard.revenueByDay} barLabel={t.revenue.clicks} lineLabel={t.revenue.conversions} /> : <Skeleton className="h-56 w-full" />}
              </Card>
              <Card title={t.dashboard.topBrands}>
                {rev ? (
                  rev.byBrand.length ? (
                    <BarList items={rev.byBrand.slice(0, 6).map((b) => ({ label: brandName(b.key), value: b.commissionMinor }))} format={(v) => money(v, rev.currency)} />
                  ) : (
                    <p className="text-sm text-muted">{t.common.noResults}</p>
                  )
                ) : (
                  <Skeleton className="h-56 w-full" />
                )}
              </Card>
              <Card title={t.dashboard.funnel} className="xl:col-span-3">
                {reports.data ? steps.length ? <FunnelChart steps={steps} label={t.dashboard.funnel} /> : <p className="text-sm text-muted">{t.common.noResults}</p> : <Skeleton className="h-40 w-full" />}
              </Card>
            </div>
          )}
        </>
      ) : (
        <Card className="mt-4">
          <p className="text-sm text-muted">{t.dashboard.noAnalytics}</p>
        </Card>
      )}

      {d && d.moderation.openReports > 0 && can('moderation.manage') && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-sm text-amber-900">
            {t.dashboard.openReports}: <strong>{d.moderation.openReports}</strong>
          </p>
          <LinkButton href={href('/moderation/')} variant="secondary">
            {t.dashboard.goModeration}
          </LinkButton>
        </div>
      )}
    </div>
  );
}
