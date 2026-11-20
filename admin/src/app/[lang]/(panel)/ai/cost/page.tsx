'use client';

import Link from 'next/link';
import { DateRange, useRange } from '@/components/DateRange';
import { RequirePermission } from '@/components/Shell';
import { CostBars, ModelsTable, OperationsTable, useAiMoney } from '@/components/aiUsage';
import { Badge, Button, Card, ErrorState, KpiTile, PageHeader, Skeleton, useAsync } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { daysBetween } from '@/lib/dates';
import { useI18n } from '@/lib/i18n';
import { downloadText, toCsv } from '@/lib/text';
import type { AiUsagePlan, AiUsageSummary } from '@/lib/types';

function Who({ handle, email, userId, href, linkable }: { handle: string | null; email: string | null; userId: string | null; href: string; linkable: boolean }) {
  const label = (
    <>
      <span className="font-medium text-ink">{handle ? `@${handle}` : (email ?? '—')}</span>
      {handle && email && <span className="block text-xs text-muted">{email}</span>}
    </>
  );
  return userId && linkable ? (
    <Link href={href} className="block rounded hover:underline focus-visible:ring-2 focus-visible:ring-brand-100 focus-visible:outline-none">
      {label}
    </Link>
  ) : (
    <span className="block">{label}</span>
  );
}

function PlanBadge({ plan }: { plan: AiUsagePlan }) {
  const { t } = useI18n();
  return <Badge tone={plan === 'premium' ? 'brand' : 'neutral'}>{t.enums.tier[plan]}</Badge>;
}

function CostInner() {
  const { t, fmt, number, percent, date, href } = useI18n();
  const { can } = useAuth();
  const [range, setRange] = useRange(30);
  const summary = useAsync(() => api.get<AiUsageSummary>('v1/admin/ai-usage/summary', { query: range }), [range.from, range.to]);
  const s = summary.data;
  const { usd, tl } = useAiMoney(s?.rates.usdTry);
  const canOpenUser = can('users.read');
  const userHref = (id: string | null) => href(`/users/detail/?id=${encodeURIComponent(id ?? '')}&tab=ai`);

  const byDay = new Map(s?.days.map((d) => [d.day, d]) ?? []);
  const days = s ? daysBetween(s.from, s.to).map((day) => ({ day, costMicroUsd: byDay.get(day)?.costMicroUsd ?? 0, calls: byDay.get(day)?.calls ?? 0 })) : [];
  const activeUsers = s?.plans.reduce((sum, p) => sum + p.activeUsers, 0) ?? 0;

  const exportCsv = () => {
    if (!s) return;
    const usdText = (micro: number | null) => (micro === null ? '' : (micro / 1_000_000).toFixed(6));
    const rows: unknown[][] = [['section', 'key', 'calls', 'jobs_or_users', 'cost_usd']];
    for (const d of days) rows.push(['day', d.day, d.calls, byDay.get(d.day)?.jobs ?? 0, usdText(d.costMicroUsd)]);
    for (const o of s.operations) rows.push(['operation', o.operation, o.calls, o.jobs, usdText(o.costMicroUsd)]);
    for (const m of s.models) rows.push(['model', m.model, m.calls, '', usdText(m.costMicroUsd)]);
    for (const p of s.plans) rows.push(['plan', p.plan, p.totals.calls, p.activeUsers, usdText(p.totals.costMicroUsd)]);
    for (const u of s.topUsers) rows.push(['top_user', u.handle ?? u.email ?? u.tenantId, u.calls, u.activeDays, usdText(u.costMicroUsd)]);
    rows.push(['total', '', s.totals.calls, s.totals.jobs, usdText(s.totals.costMicroUsd)]);
    downloadText(`droblet-ai-cost-${s.from}_${s.to}.csv`, toCsv(rows));
  };

  return (
    <div>
      <PageHeader
        title={t.aiUsage.costTitle}
        subtitle={t.aiUsage.costSubtitle}
        actions={
          <Button variant="secondary" icon="download" disabled={!s} onClick={exportCsv}>
            {t.common.exportCsv}
          </Button>
        }
      />
      <Card className="mb-4">
        <DateRange value={range} onChange={setRange} />
      </Card>

      {summary.error ? (
        <Card>
          <ErrorState error={summary.error} onRetry={summary.reload} />
        </Card>
      ) : !s ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-[118px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile
              icon="trending"
              tone="amber"
              label={t.aiUsage.totalCost}
              value={usd(s.totals.costMicroUsd)}
              sub={`${tl(s.totals.costMicroUsd)} · ${fmt(t.aiUsage.perDay, { cost: usd(days.length ? s.totals.costMicroUsd / days.length : 0) })}`}
            />
            <KpiTile icon="sparkle" label={t.aiUsage.calls} value={number(s.totals.calls)} sub={fmt(t.aiUsage.callsSub, { jobs: number(s.totals.jobs), failed: number(s.totals.failed) })} />
            <KpiTile icon="users" tone="blue" label={t.aiUsage.activeUsersTotal} value={number(activeUsers)} />
            <KpiTile icon="key" tone="green" label={t.aiUsage.adminTrials} value={usd(s.admin.costMicroUsd)} sub={fmt(t.aiUsage.adminTrialsSub, { calls: number(s.admin.calls) })} />
          </div>
          <p className="-mt-2 text-xs text-muted">{fmt(t.aiUsage.rateNote, { rate: s.rates.usdTry })}</p>

          <Card title={t.aiUsage.daily}>
            <CostBars days={days} label={t.aiUsage.daily} usd={usd} />
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <OperationsTable rows={s.operations} usd={usd} tl={tl} title={t.aiUsage.byOperation} />
            </div>
            <ModelsTable rows={s.models} usd={usd} title={t.aiUsage.byModel} />
          </div>

          <Card title={t.aiUsage.margin} padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-stone-50/60 text-left text-xs text-muted">
                    <th className="px-5 py-2.5 font-medium">{t.aiUsage.plan}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.activeUsers}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.cost}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.costPerUser}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.costPer30}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.shareMonthly}</th>
                    <th className="px-5 py-2.5 text-right font-medium">{t.aiUsage.shareYearly}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.plans.map((p) => (
                    <tr key={p.plan} className="border-b border-line last:border-b-0">
                      <td className="px-5 py-3">
                        <PlanBadge plan={p.plan} />
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{number(p.activeUsers)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{usd(p.totals.costMicroUsd)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{usd(p.costPerActiveUserMicroUsd)}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                        <span className="font-medium">{usd(p.costPerActiveUserPer30DaysMicroUsd)}</span>
                        <span className="block text-xs text-muted">{tl(p.costPerActiveUserPer30DaysMicroUsd)}</span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {p.shareOfMonthlyNet === null ? <span className="text-muted">{t.aiUsage.noRevenue}</span> : <Share value={p.shareOfMonthlyNet} text={percent(p.shareOfMonthlyNet)} />}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {p.shareOfYearlyNet === null ? <span className="text-muted">{t.aiUsage.noRevenue}</span> : <Share value={p.shareOfYearlyNet} text={percent(p.shareOfYearlyNet)} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-5 py-3 text-xs text-muted">
              {fmt(t.aiUsage.marginHint, { monthly: s.rates.netMonthlyPlanTry, yearly: s.rates.netYearlyPlanPerMonthTry })}
            </p>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card title={t.aiUsage.topUsers} padded={s.topUsers.length === 0}>
              {s.topUsers.length === 0 ? (
                <p className="text-sm text-muted">{t.aiUsage.noUsage}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-stone-50/60 text-left text-xs text-muted">
                      <th className="px-5 py-2.5 font-medium">{t.aiUsage.user}</th>
                      <th className="px-3 py-2.5 font-medium">{t.aiUsage.plan}</th>
                      <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.activeDays}</th>
                      <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.calls}</th>
                      <th className="px-5 py-2.5 text-right font-medium">{t.aiUsage.cost}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.topUsers.map((u) => (
                      <tr key={u.tenantId} className="border-b border-line last:border-b-0">
                        <td className="px-5 py-2.5">
                          <Who handle={u.handle} email={u.email} userId={u.userId} href={userHref(u.userId)} linkable={canOpenUser} />
                        </td>
                        <td className="px-3 py-2.5">
                          <PlanBadge plan={u.plan} />
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{number(u.activeDays)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{number(u.calls)}</td>
                        <td className="px-5 py-2.5 text-right whitespace-nowrap tabular-nums">
                          <span className="font-medium">{usd(u.costMicroUsd)}</span>
                          <span className="block text-xs text-muted">{tl(u.costMicroUsd)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title={t.aiUsage.anomalies} padded={s.anomalies.length === 0}>
              {s.anomalies.length === 0 ? (
                <p className="text-sm text-muted">{t.aiUsage.noAnomalies}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-stone-50/60 text-left text-xs text-muted">
                      <th className="px-5 py-2.5 font-medium">{t.aiUsage.day}</th>
                      <th className="px-3 py-2.5 font-medium">{t.aiUsage.user}</th>
                      <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.cost}</th>
                      <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.median}</th>
                      <th className="px-5 py-2.5 font-medium">{t.aiUsage.multiple}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.anomalies.map((a) => (
                      <tr key={`${a.day}-${a.tenantId}`} className="border-b border-line align-top last:border-b-0">
                        <td className="px-5 py-2.5 whitespace-nowrap text-muted">{date(a.day)}</td>
                        <td className="px-3 py-2.5">
                          <Who handle={a.handle} email={a.email} userId={a.userId} href={userHref(a.userId)} linkable={canOpenUser} />
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium tabular-nums">{usd(a.costMicroUsd)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{usd(a.medianMicroUsd)}</td>
                        <td className="px-5 py-2.5">
                          <span className="mr-1 tabular-nums">{a.multiple === null ? '—' : `${a.multiple}×`}</span>
                          <span className="inline-flex flex-wrap gap-1">
                            {a.reasons.map((r) => (
                              <Badge key={r} tone={r === 'absolute' ? 'red' : 'amber'}>
                                {t.aiUsage.reasons[r]}
                              </Badge>
                            ))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className={s.anomalies.length === 0 ? 'mt-2 text-xs text-muted' : 'border-t border-line px-5 py-3 text-xs text-muted'}>
                {fmt(t.aiUsage.anomalyHint, { x: s.thresholds.medianMultiplier, abs: s.thresholds.absoluteDayUsd })}
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

/** A percentage with a small bar; red above 100% (AI costs more than the plan earns). */
function Share({ value, text }: { value: number; text: string }) {
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <span className="inline-block w-28 text-right">
      <span className={value > 1 ? 'font-medium text-red-700' : value > 0.6 ? 'font-medium text-amber-800' : 'font-medium text-ink'}>{text}</span>
      <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="mt-1 h-1 w-full" aria-hidden="true">
        <rect width="100" height="6" rx="3" fill="#f0ece6" />
        <rect width={pct} height="6" rx="3" fill={value > 1 ? '#b42318' : value > 0.6 ? '#b54708' : '#6e5640'} />
      </svg>
    </span>
  );
}

export default function AiCostPage() {
  return (
    <RequirePermission permission="ai.usage.view">
      <CostInner />
    </RequirePermission>
  );
}
