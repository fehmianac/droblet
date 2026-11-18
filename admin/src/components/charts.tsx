'use client';

import { useI18n } from '@/lib/i18n';

// Small dependency-free SVG charts. Every chart has a text alternative (title + the tables next to it).

export function DailyChart({
  days,
  label,
  barLabel,
  lineLabel,
}: {
  days: { day: string; bar: number; line: number }[];
  label: string;
  barLabel: string;
  lineLabel: string;
}) {
  const { date } = useI18n();
  const width = 720;
  const height = 220;
  const pad = { l: 36, r: 12, t: 12, b: 28 };
  const maxBar = Math.max(1, ...days.map((d) => d.bar));
  const maxLine = Math.max(1, ...days.map((d) => d.line));
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const step = days.length ? innerW / days.length : innerW;
  const barW = Math.max(2, Math.min(18, step * 0.6));
  const linePoints = days
    .map((d, i) => `${pad.l + step * i + step / 2},${pad.t + innerH - (d.line / maxLine) * innerH}`)
    .join(' ');
  const ticks = [0, 0.5, 1];
  const labelEvery = Math.max(1, Math.ceil(days.length / 6));

  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto max-h-80 w-full" role="img" aria-label={label}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={pad.l} x2={width - pad.r} y1={pad.t + innerH * (1 - tk)} y2={pad.t + innerH * (1 - tk)} stroke="#ece9e4" />
            <text x={pad.l - 6} y={pad.t + innerH * (1 - tk) + 4} textAnchor="end" fontSize="10" fill="#8c857b">
              {Math.round(maxBar * tk)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const h = (d.bar / maxBar) * innerH;
          return (
            <rect
              key={d.day}
              x={pad.l + step * i + (step - barW) / 2}
              y={pad.t + innerH - h}
              width={barW}
              height={h}
              rx={2}
              fill="#d9c7b5"
            >
              <title>{`${date(d.day)}: ${barLabel} ${d.bar}, ${lineLabel} ${d.line}`}</title>
            </rect>
          );
        })}
        {days.length > 1 && <polyline points={linePoints} fill="none" stroke="#6e5640" strokeWidth={2} strokeLinejoin="round" />}
        {days.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={d.day} x={pad.l + step * i + step / 2} y={height - 8} textAnchor="middle" fontSize="10" fill="#8c857b">
              {d.day.slice(5)}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="mt-2 flex gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-200" aria-hidden="true" />
          {barLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3 bg-brand-600" aria-hidden="true" />
          {lineLabel}
        </span>
      </figcaption>
    </figure>
  );
}

export function BarList({ items, format }: { items: { label: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex justify-between gap-3 text-sm">
            <span className="truncate text-ink">{item.label}</span>
            <span className="shrink-0 font-medium text-ink tabular-nums">{format(item.value)}</span>
          </div>
          <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="h-1.5 w-full" aria-hidden="true">
            <rect width="100" height="6" rx="3" fill="#f0ece6" />
            <rect width={(item.value / max) * 100} height="6" rx="3" fill="#8a6d52" />
          </svg>
        </li>
      ))}
    </ul>
  );
}

export function FunnelChart({ steps, label }: { steps: { name: string; value: number; rate: string }[]; label: string }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <ol className="space-y-2" aria-label={label}>
      {steps.map((s) => (
        <li key={s.name} className="grid grid-cols-[minmax(0,11rem)_1fr_4.5rem] items-center gap-3 text-sm">
          <span className="truncate text-muted">{s.name}</span>
          <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-5 w-full" aria-hidden="true">
            <rect width={Math.max(0.5, (s.value / max) * 100)} height="10" rx="1.5" fill="#6e5640" opacity={0.25 + 0.75 * (s.value / max)} />
          </svg>
          <span className="text-right tabular-nums">
            <span className="font-medium text-ink">{s.value}</span> <span className="text-xs text-muted">{s.rate}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
