'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { daysBetween, isoDay, lastDays } from '@/lib/dates';
import { useI18n } from '@/lib/i18n';
import type { UserAiUsage } from '@/lib/types';
import { CostBars, ModelsTable, OperationsTable, formatDuration, opLabel, useAiMoney } from './aiUsage';
import { Icon } from './icons';
import { Badge, Button, Card, ErrorState, Input, KpiTile, Skeleton, useAsync } from './ui';

type Period = 'month' | '30' | 'custom';

function thisMonth(): { from: string; to: string } {
  const now = new Date();
  return { from: isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: isoDay(now) };
}

const outcomeTone = { completed: 'green', failed: 'red', refunded: 'amber', running: 'blue' } as const;

/** User detail tab "AI kullanımı" (ai.usage.view). Each load is audited on the server (user.ai_usage_view). */
export function UserAiUsageTab({ userId }: { userId: string }) {
  const { t, fmt, number, dateTime, date } = useI18n();
  const [period, setPeriod] = useState<Period>('month');
  const [range, setRange] = useState(thisMonth);
  const [draft, setDraft] = useState(range);
  const usage = useAsync(
    () => api.get<UserAiUsage>(`v1/admin/user/${encodeURIComponent(userId)}/ai-usage`, { query: range }),
    [userId, range.from, range.to],
  );
  const u = usage.data;
  const { usd, tl } = useAiMoney(u?.rates.usdTry);

  const choose = (next: Period) => {
    setPeriod(next);
    if (next === 'month') setRange(thisMonth());
    if (next === '30') setRange(lastDays(30));
    if (next === 'custom') setDraft(range);
  };

  const byDay = new Map(u?.days.map((d) => [d.period, d.totals]) ?? []);
  const bars = u ? daysBetween(u.from, u.to).map((day) => ({ day, costMicroUsd: byDay.get(day)?.costMicroUsd ?? 0, calls: byDay.get(day)?.calls ?? 0 })) : [];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['month', t.aiUsage.periodThisMonth],
              ['30', t.aiUsage.period30],
              ['custom', t.aiUsage.periodCustom],
            ] as [Period, string][]
          ).map(([id, label]) => (
            <Button key={id} size="sm" variant={period === id ? 'secondary' : 'ghost'} aria-pressed={period === id} onClick={() => choose(id)}>
              {label}
            </Button>
          ))}
          {period === 'custom' && (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.from && draft.to && draft.from <= draft.to) setRange(draft);
              }}
            >
              <Input type="date" aria-label={t.common.from} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className="h-9 w-40" />
              <span className="text-muted" aria-hidden="true">
                –
              </span>
              <Input type="date" aria-label={t.common.to} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className="h-9 w-40" />
              <Button type="submit" size="sm" variant="secondary">
                {t.common.apply}
              </Button>
            </form>
          )}
          <span className="ml-auto text-xs text-muted">{u ? `${date(u.from)} – ${date(u.to)}` : null}</span>
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-muted">
          <Icon name="shield" className="h-4 w-4 shrink-0" />
          {t.aiUsage.userHint}
        </p>
      </Card>

      {usage.error ? (
        <Card>
          <ErrorState error={usage.error} onRetry={usage.reload} />
        </Card>
      ) : !u ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[118px] rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile icon="sparkle" label={t.aiUsage.calls} value={number(u.totals.calls)} sub={fmt(t.aiUsage.callsSub, { jobs: u.totals.jobs, failed: u.totals.failed })} />
            <KpiTile icon="trending" tone="amber" label={t.aiUsage.cost} value={usd(u.totals.costMicroUsd)} sub={tl(u.totals.costMicroUsd)} />
            <KpiTile
              icon="user"
              tone={u.plan === 'premium' ? 'green' : 'blue'}
              label={t.aiUsage.plan}
              value={<Badge tone={u.plan === 'premium' ? 'brand' : 'neutral'}>{t.enums.tier[u.plan]}</Badge>}
            />
            <KpiTile
              icon="gift"
              tone="blue"
              label={t.aiUsage.credits}
              value={number(u.credits.allowanceRemaining + u.credits.packBalance)}
              sub={fmt(t.aiUsage.creditsValue, { allowance: `${u.credits.allowanceRemaining}/${u.credits.allowanceTotal}`, pack: u.credits.packBalance })}
            />
          </div>
          <p className="-mt-2 text-xs text-muted">{fmt(t.aiUsage.rateNote, { rate: u.rates.usdTry })}</p>

          <Card title={t.aiUsage.daily}>
            {u.totals.calls === 0 ? <p className="text-sm text-muted">{t.aiUsage.noUsage}</p> : <CostBars days={bars} label={t.aiUsage.daily} usd={usd} compact />}
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <OperationsTable rows={u.operations} usd={usd} tl={tl} title={t.aiUsage.byOperation} />
            </div>
            <ModelsTable rows={u.models} usd={usd} title={t.aiUsage.byModel} />
          </div>

          <Card title={t.aiUsage.recentJobs} padded={u.recentJobs.length === 0}>
            {u.recentJobs.length === 0 ? (
              <p className="text-sm text-muted">{t.aiUsage.noJobs}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-line bg-stone-50/60 text-left text-xs text-muted">
                      <th className="px-5 py-2.5 font-medium">{t.common.createdAt}</th>
                      <th className="px-3 py-2.5 font-medium">{t.aiUsage.kind}</th>
                      <th className="px-3 py-2.5 font-medium">{t.aiUsage.model}</th>
                      <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.duration}</th>
                      <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.cost}</th>
                      <th className="px-3 py-2.5 font-medium">{t.aiUsage.outcome}</th>
                      <th className="px-5 py-2.5 text-right font-medium">{t.aiUsage.creditsMoved}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.recentJobs.map((j) => (
                      <tr key={j.id} className="border-b border-line last:border-b-0">
                        <td className="px-5 py-2.5 whitespace-nowrap text-muted">{dateTime(j.createdAt)}</td>
                        <td className="px-3 py-2.5">
                          {opLabel(t, kindOperation(j.kind))}
                          <span className="block font-mono text-[11px] text-muted">{j.id}</span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs">{j.models.length ? j.models.join(', ') : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatDuration(j.durationMs)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{usd(j.costMicroUsd)}</td>
                        <td className="px-3 py-2.5">
                          <Badge tone={outcomeTone[j.outcome]}>{t.aiUsage.outcomes[j.outcome]}</Badge>
                          {j.failure && <span className="ml-1 text-xs text-muted">{j.failure}</span>}
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums">
                          {j.creditsCharged || j.creditsRefunded ? fmt(t.aiUsage.creditsMovedValue, { charged: j.creditsCharged, refunded: j.creditsRefunded }) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/** Job kind → the operation label it is counted under. */
function kindOperation(kind: string): string {
  switch (kind) {
    case 'stylistOutfit':
    case 'stylistComplete':
      return 'stylist_outfit';
    case 'stylistWeek':
      return 'stylist_week';
    case 'stylistPack':
      return 'stylist_pack';
    case 'itemProcess':
    case 'itemSplit':
      return 'item_detection';
    case 'itemClean':
      return 'multi_item';
    case 'outfitImport':
      return 'import_detect';
    case 'palette':
      return 'palette';
    case 'tryOn':
      return 'tryon';
    default:
      return kind;
  }
}
