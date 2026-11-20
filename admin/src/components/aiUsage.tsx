'use client';

import { useMemo } from 'react';
import { locales } from '@/i18n';
import { useI18n } from '@/lib/i18n';
import type { AiUsageModelRow, AiUsageOperationRow } from '@/lib/types';
import { Card } from './ui';

// Shared pieces of the AI usage views (AI › Maliyet, user detail "AI kullanımı"). Money arrives as estimated micro-USD.

/** $ and ₺ formatters for micro-USD (₺ uses the configured USD/TRY rate the API returns). */
export function useAiMoney(usdTry: number | undefined) {
  const { lang } = useI18n();
  return useMemo(() => {
    const locale = locales[lang];
    const usdSmall = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const usdBig = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const tryFmt = new Intl.NumberFormat(locale, { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const usd = (micro: number | null | undefined) => {
      if (micro === null || micro === undefined) return '—';
      const v = micro / 1_000_000;
      return (Math.abs(v) >= 10 ? usdBig : usdSmall).format(v);
    };
    const tl = (micro: number | null | undefined) => (micro === null || micro === undefined || !usdTry ? '—' : tryFmt.format((micro / 1_000_000) * usdTry));
    return { usd, tl };
  }, [lang, usdTry]);
}

export function opLabel(t: ReturnType<typeof useI18n>['t'], op: string): string {
  return (t.enums.aiOperation as Record<string, string>)[op] ?? op;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/**
 * Simple SVG bars of the daily cost (no chart dependency). Every bar has a native tooltip; the tables next to the chart
 * carry the same numbers as text.
 */
export function CostBars({
  days,
  label,
  usd,
  compact = false,
}: {
  days: { day: string; costMicroUsd: number; calls: number }[];
  label: string;
  usd: (micro: number) => string;
  compact?: boolean;
}) {
  const { t, date } = useI18n();
  const width = 720;
  const height = compact ? 140 : 220;
  const pad = { l: 56, r: 8, t: 10, b: 24 };
  const max = Math.max(1, ...days.map((d) => d.costMicroUsd));
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const step = days.length ? innerW / days.length : innerW;
  const barW = Math.max(2, Math.min(22, step * 0.7));
  const labelEvery = Math.max(1, Math.ceil(days.length / (compact ? 5 : 8)));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={compact ? 'h-auto max-h-44 w-full' : 'h-auto max-h-80 w-full'} role="img" aria-label={label}>
      {[0, 0.5, 1].map((tk) => (
        <g key={tk}>
          <line x1={pad.l} x2={width - pad.r} y1={pad.t + innerH * (1 - tk)} y2={pad.t + innerH * (1 - tk)} stroke="#ece9e4" />
          <text x={pad.l - 6} y={pad.t + innerH * (1 - tk) + 4} textAnchor="end" fontSize="10" fill="#8c857b">
            {usd(max * tk)}
          </text>
        </g>
      ))}
      {days.map((d, i) => {
        const h = (d.costMicroUsd / max) * innerH;
        return (
          <rect key={d.day} x={pad.l + step * i + (step - barW) / 2} y={pad.t + innerH - h} width={barW} height={Math.max(h, d.costMicroUsd > 0 ? 1 : 0)} rx={2} fill="#8a6d52">
            <title>{`${date(d.day)}: ${usd(d.costMicroUsd)} · ${d.calls} ${t.aiUsage.dailyCalls}`}</title>
          </rect>
        );
      })}
      {days.map((d, i) =>
        i % labelEvery === 0 ? (
          <text key={d.day} x={pad.l + step * i + step / 2} y={height - 6} textAnchor="middle" fontSize="10" fill="#8c857b">
            {d.day.slice(5)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** A thin share bar inside a table cell. */
function Share({ value, max }: { value: number; max: number }) {
  return (
    <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="mt-1 h-1 w-full" aria-hidden="true">
      <rect width="100" height="6" rx="3" fill="#f0ece6" />
      <rect width={max > 0 ? (value / max) * 100 : 0} height="6" rx="3" fill="#8a6d52" />
    </svg>
  );
}

export function OperationsTable({ rows, usd, tl, title }: { rows: AiUsageOperationRow[]; usd: (m: number) => string; tl: (m: number) => string; title: string }) {
  const { t, number } = useI18n();
  const max = Math.max(0, ...rows.map((r) => r.costMicroUsd));
  return (
    <Card title={title} padded={false}>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">{t.aiUsage.noUsage}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line bg-stone-50/60 text-left text-xs text-muted">
                <th className="px-5 py-2.5 font-medium">{t.aiUsage.operation}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.calls}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.failed}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.inputTokens}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.outputTokens}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.images}</th>
                <th className="px-5 py-2.5 text-right font-medium">{t.aiUsage.cost}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.operation} className="border-b border-line last:border-b-0">
                  <td className="px-5 py-2.5">
                    {opLabel(t, r.operation)}
                    <Share value={r.costMicroUsd} max={max} />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{number(r.calls)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.failed ? <span className="text-red-700">{number(r.failed)}</span> : '0'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{number(r.inputTokens)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{number(r.outputTokens)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{number(r.images)}</td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap tabular-nums">
                    <span className="font-medium">{usd(r.costMicroUsd)}</span>
                    <span className="block text-xs text-muted">{tl(r.costMicroUsd)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function ModelsTable({ rows, usd, title }: { rows: AiUsageModelRow[]; usd: (m: number) => string; title: string }) {
  const { t, number } = useI18n();
  const max = Math.max(0, ...rows.map((r) => r.costMicroUsd));
  return (
    <Card title={title} padded={false}>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">{t.aiUsage.noUsage}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-stone-50/60 text-left text-xs text-muted">
              <th className="px-5 py-2.5 font-medium">{t.aiUsage.model}</th>
              <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.calls}</th>
              <th className="px-3 py-2.5 text-right font-medium">{t.aiUsage.cachedTokens}</th>
              <th className="px-5 py-2.5 text-right font-medium">{t.aiUsage.cost}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.model} className="border-b border-line last:border-b-0">
                <td className="px-5 py-2.5">
                  <span className="font-mono text-xs">{r.model}</span>
                  <Share value={r.costMicroUsd} max={max} />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{number(r.calls)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{number(r.cachedTokens)}</td>
                <td className="px-5 py-2.5 text-right font-medium whitespace-nowrap tabular-nums">{usd(r.costMicroUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
