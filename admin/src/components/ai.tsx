'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { AiPromptDetail, AiPromptSummary, AiTrial, AiTrialRequest } from '@/lib/types';
import { Icon } from './icons';
import { Badge, Button, cx, useToast } from './ui';

// ── Templates (mirror of Domain PromptTemplate / PromptCatalog.Validate; the server validates again) ─────

const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g;

export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]!))];
}

/** Characters before the first placeholder: the part of the text that is the same in every request. */
export function staticPrefix(text: string): number {
  PLACEHOLDER.lastIndex = 0;
  const match = PLACEHOLDER.exec(text);
  PLACEHOLDER.lastIndex = 0;
  return match ? match.index : text.length;
}

export function hasMalformedPlaceholder(text: string): boolean {
  return /\{\{|\}\}/.test(text.replace(PLACEHOLDER, ''));
}

/** Field → code, same keys as the server: text (empty | too_long | malformed_placeholder), placeholders.{name} (missing | unknown). */
export function validatePrompt(detail: AiPromptDetail, text: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!text.trim()) return { text: 'empty' };
  if (detail.maxLength !== null && text.length > detail.maxLength) errors.text = 'too_long';
  else if (hasMalformedPlaceholder(text)) errors.text = 'malformed_placeholder';
  const used = placeholders(text);
  for (const v of detail.variables) if (v.required && !used.includes(v.name)) errors[`placeholders.${v.name}`] = 'missing';
  for (const name of used) if (!detail.variables.some((v) => v.name === name)) errors[`placeholders.${name}`] = 'unknown';
  return errors;
}

/** cache_prefix_shorter when a variable moves above static text that precedes it in the code default. */
export function cacheWarnings(detail: AiPromptDetail, text: string): string[] {
  if (!detail.variables.length) return [];
  return staticPrefix(text) < detail.defaultStaticPrefix ? ['cache_prefix_shorter'] : [];
}

export function renderTemplate(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (all, name: string) => values[name] ?? all);
}

// ── Editor: monospace text with highlighted placeholders ─────────────────────────────────────────────

type Segment = { text: string; kind: 'plain' | 'required' | 'optional' | 'unknown' | 'malformed' };

function segments(text: string, required: Set<string>, optional: Set<string>): Segment[] {
  const out: Segment[] = [];
  const token = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}|\{\{|\}\}/g;
  let last = 0;
  for (const m of text.matchAll(token)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), kind: 'plain' });
    const name = m[1];
    out.push({
      text: m[0],
      kind: name === undefined ? 'malformed' : required.has(name) ? 'required' : optional.has(name) ? 'optional' : 'unknown',
    });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: 'plain' });
  return out;
}

const segmentClass: Record<Segment['kind'], string> = {
  plain: '',
  required: 'rounded bg-brand-100 text-brand-800',
  optional: 'rounded bg-sky-100 text-sky-800',
  unknown: 'rounded bg-red-100 text-red-700',
  malformed: 'rounded bg-red-200 text-red-800',
};

const editorText = 'font-mono text-[13px] leading-6 whitespace-pre-wrap break-words p-3';

export function PromptEditor({
  id,
  value,
  onChange,
  detail,
  readOnly,
  invalid,
  editorRef,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  detail: AiPromptDetail;
  readOnly?: boolean;
  invalid?: boolean;
  editorRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const backdrop = useRef<HTMLPreElement>(null);
  const required = useMemo(() => new Set(detail.variables.filter((v) => v.required).map((v) => v.name)), [detail.variables]);
  const optional = useMemo(() => new Set(detail.variables.filter((v) => !v.required).map((v) => v.name)), [detail.variables]);
  const parts = useMemo(() => segments(value, required, optional), [value, required, optional]);
  return (
    <div className={cx('relative h-[420px] overflow-hidden rounded-lg border bg-white', invalid ? 'border-red-400' : 'border-line')}>
      <pre ref={backdrop} aria-hidden="true" className={cx('pointer-events-none absolute inset-0 m-0 overflow-hidden text-ink', editorText)}>
        {parts.map((p, i) =>
          p.kind === 'plain' ? (
            <span key={i}>{p.text}</span>
          ) : (
            <mark key={i} className={segmentClass[p.kind]}>
              {p.text}
            </mark>
          ),
        )}
        {'\n'}
      </pre>
      <textarea
        id={id}
        ref={editorRef}
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop;
        }}
        className={cx(
          'absolute inset-0 h-full w-full resize-none bg-transparent text-transparent caret-stone-900 outline-none selection:bg-brand-200/60 focus:ring-2 focus:ring-brand-100',
          editorText,
        )}
      />
    </div>
  );
}

// ── Word diff (LCS over words and whitespace) ────────────────────────────────────────────────────────

export type DiffPart = { text: string; op: 'same' | 'add' | 'del' };

function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

export function diffWords(before: string, after: string): DiffPart[] {
  let a = tokenize(before);
  let b = tokenize(after);
  // Common prefix / suffix first: most edits touch a small part of a long prompt.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head = a.slice(0, start).join('');
  const tail = a.slice(endA).join('');
  a = a.slice(start, endA);
  b = b.slice(start, endB);
  const parts: DiffPart[] = [];
  if (head) parts.push({ text: head, op: 'same' });
  if (a.length * b.length > 4_000_000) {
    // Too large for a table: show it as one replacement.
    if (a.length) parts.push({ text: a.join(''), op: 'del' });
    if (b.length) parts.push({ text: b.join(''), op: 'add' });
  } else {
    const n = a.length;
    const m = b.length;
    const table = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        table[i * (m + 1) + j] = a[i] === b[j] ? table[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(table[(i + 1) * (m + 1) + j]!, table[i * (m + 1) + j + 1]!);
    let i = 0;
    let j = 0;
    const push = (text: string, op: DiffPart['op']) => {
      const prev = parts[parts.length - 1];
      if (prev && prev.op === op) prev.text += text;
      else parts.push({ text, op });
    };
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        push(a[i]!, 'same');
        i++;
        j++;
      } else if (table[(i + 1) * (m + 1) + j]! >= table[i * (m + 1) + j + 1]!) push(a[i++]!, 'del');
      else push(b[j++]!, 'add');
    }
    while (i < n) push(a[i++]!, 'del');
    while (j < m) push(b[j++]!, 'add');
  }
  if (tail) {
    const prev = parts[parts.length - 1];
    if (prev && prev.op === 'same') prev.text += tail;
    else parts.push({ text: tail, op: 'same' });
  }
  return parts;
}

export function DiffView({ before, after, empty }: { before: string; after: string; empty: ReactNode }) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  if (parts.every((p) => p.op === 'same')) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <pre className={cx('max-h-[420px] overflow-auto rounded-lg border border-line bg-stone-50 text-ink', editorText)}>
      {parts.map((p, i) =>
        p.op === 'same' ? (
          <span key={i}>{p.text}</span>
        ) : p.op === 'add' ? (
          <ins key={i} className="rounded bg-emerald-100 text-emerald-900 no-underline">
            {p.text}
          </ins>
        ) : (
          <del key={i} className="rounded bg-red-100 text-red-800">
            {p.text}
          </del>
        ),
      )}
    </pre>
  );
}

// ── Trials: start, then poll until the worker has finished ───────────────────────────────────────────

const POLL_MS = 2000;
const POLL_LIMIT_MS = 180_000;

export function useTrial() {
  const [trial, setTrial] = useState<AiTrial | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async (request: AiTrialRequest): Promise<AiTrial | null> => {
    setBusy(true);
    setTrial(null);
    try {
      let current = await api.post<AiTrial>('v1/admin/ai/trial', request);
      if (alive.current) setTrial(current);
      const started = Date.now();
      while ((current.status === 'queued' || current.status === 'running') && Date.now() - started < POLL_LIMIT_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (!alive.current) return null;
        current = await api.get<AiTrial>(`v1/admin/ai/trial/${encodeURIComponent(current.id)}`);
        if (alive.current) setTrial(current);
      }
      return current;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  return { trial, busy, run, reset: () => setTrial(null) };
}

export function TrialStatusBadge({ trial }: { trial: AiTrial }) {
  const { t } = useI18n();
  const tone = trial.status === 'succeeded' ? 'green' : trial.status === 'failed' ? 'red' : 'amber';
  return <Badge tone={tone}>{t.ai.status[trial.status]}</Badge>;
}

export function TrialResult({ trial }: { trial: AiTrial }) {
  const { t, fmt, number } = useI18n();
  const done = trial.status === 'succeeded' || trial.status === 'failed';
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <TrialStatusBadge trial={trial} />
        {trial.parsed === true && <Badge tone="green">{t.ai.parsedOk}</Badge>}
        {trial.parsed === false && <Badge tone="red">{t.ai.parsedFail}</Badge>}
        {trial.latencyMs !== null && (
          <span className="text-xs text-muted">
            {t.ai.latency}: {number(trial.latencyMs)} ms
          </span>
        )}
        {trial.usedModel && (
          <span className="text-xs text-muted">
            {t.ai.model}: <span className="font-mono">{trial.usedModel}</span>
          </span>
        )}
        {trial.inputTokens !== null && (
          <span className="text-xs text-muted">
            {t.ai.tokens}: {fmt(t.ai.tokensValue, { input: number(trial.inputTokens), cached: number(trial.cachedTokens ?? 0), output: number(trial.outputTokens ?? 0) })}
          </span>
        )}
      </div>
      {!done && <p className="text-xs text-muted">{t.ai.waiting}</p>}
      {trial.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{trial.error}</p>}
      {trial.parseError && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{trial.parseError}</p>}
      {trial.output !== null && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">{t.ai.rawOutput}</p>
          <pre className={cx('max-h-80 overflow-auto rounded-lg border border-line bg-stone-50 text-ink', editorText)}>{trial.output}</pre>
        </div>
      )}
      {(trial.systemPrompt || trial.userPrompt) && trial.type === 'prompt' && (
        <details className="rounded-lg border border-line px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted">{t.ai.sentPrompts}</summary>
          {trial.systemPrompt && (
            <>
              <p className="mt-2 text-xs text-muted">{t.ai.sentSystem}</p>
              <pre className={cx('max-h-60 overflow-auto rounded bg-stone-50', editorText)}>{trial.systemPrompt}</pre>
            </>
          )}
          {trial.userPrompt && (
            <>
              <p className="mt-2 text-xs text-muted">{t.ai.sentUser}</p>
              <pre className={cx('max-h-60 overflow-auto rounded bg-stone-50', editorText)}>{trial.userPrompt}</pre>
            </>
          )}
        </details>
      )}
    </div>
  );
}

// ── Automatic fallback banner ────────────────────────────────────────────────────────────────────────

export function FallbackBanner({ prompt, onAcknowledged }: { prompt: AiPromptSummary; onAcknowledged: (next: AiPromptDetail) => void }) {
  const { t, fmt, dateTime, errorText } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const f = prompt.fallback;
  if (!f || f.acknowledged) return null;
  return (
    <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p className="flex items-center gap-2">
        <Icon name="alert" className="h-4 w-4 shrink-0" />
        {fmt(t.ai.fallbackBanner, { key: prompt.key, from: f.fromVersion, failures: f.failures, reason: f.reason, at: dateTime(f.at) })}
      </p>
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            onAcknowledged(await api.post<AiPromptDetail>(`v1/admin/ai/prompt/${encodeURIComponent(prompt.key)}/acknowledge`));
          } catch (error) {
            toast.error(errorText(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t.ai.acknowledge}
      </Button>
    </div>
  );
}
