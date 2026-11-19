'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { TrialStatusBadge, useTrial } from '@/components/ai';
import { RequirePermission } from '@/components/Shell';
import { fieldErrors } from '@/components/forms';
import { Icon } from '@/components/icons';
import { Badge, Button, Card, Checkbox, ErrorState, Field, Input, PageHeader, Select, Skeleton, Toggle, useAsync, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { AiModelSettings, AiSettingField } from '@/lib/types';

type Value = number | boolean | string | null;

const TEXT_FIELDS = ['TextModel', 'FastTextModel', 'FastTextOperations', 'ServiceTier', 'ReasoningEffort.Default', 'PromptCacheKey', 'TimeoutSeconds'];
const IMAGE_FIELDS = [
  'ImageModel',
  'ImageSize',
  'Image.Size',
  'Image.Quality',
  'Image.TryOnSize',
  'Image.TryOnQuality',
  'Image.TryOnInputFidelity',
  'Image.TryOnPreview',
  'Image.PreviewQuality',
  'Image.CleanupSize',
  'Image.CleanupQuality',
];
const SAFETY_FIELDS = ['Prompts.Enabled', 'Prompts.CacheSeconds', 'Prompts.FailureThreshold', 'Prompts.FailureWindowMinutes'];

/** Mirrors the server rules; the server validates again (and checks the model allow-list). */
function problem(field: AiSettingField, value: Value, models: string[]): string | null {
  if (value === null || value === '') return field.nullable ? null : 'invalid';
  switch (field.type) {
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'invalid';
      return (field.min != null && value < field.min) || (field.max != null && value > field.max) ? 'out_of_range' : null;
    case 'bool':
      return typeof value === 'boolean' ? null : 'invalid';
    case 'model':
      if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value)) return 'invalid';
      return models.length === 0 ? 'models_unknown' : models.includes(value) ? null : 'not_available';
    case 'choice':
      return typeof value === 'string' && (field.options ?? []).includes(value) ? null : 'invalid';
    case 'operationList':
      return typeof value === 'string' && (value === '' || value.split(',').every((p) => (field.options ?? []).includes(p.trim()))) ? null : 'invalid';
  }
}

function TestResult({ result }: { result: ReturnType<typeof useTrial>['trial'] }) {
  const { t, fmt, number } = useI18n();
  if (!result) return null;
  if (result.status === 'queued' || result.status === 'running') return <TrialStatusBadge trial={result} />;
  return result.status === 'succeeded' ? (
    <span className="text-xs text-emerald-700">{fmt(t.ai.testOk, { ms: number(result.latencyMs ?? 0), model: result.usedModel ?? result.model ?? '' })}</span>
  ) : (
    <span className="text-xs break-all text-red-700">{fmt(t.ai.testFailed, { error: result.error ?? '' })}</span>
  );
}

function TestButton({ model, kind, effort, tier }: { model: string | null; kind: 'text' | 'image'; effort?: string | null; tier?: string | null }) {
  const { t, errorText } = useI18n();
  const toast = useToast();
  const test = useTrial();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        icon="sparkle"
        loading={test.busy}
        disabled={!model}
        onClick={() =>
          void test.run({ type: 'model', model: model ?? '', modelKind: kind, effort: effort ?? null, serviceTier: tier ?? null }).catch((error: unknown) => toast.error(errorText(error)))
        }
      >
        {t.ai.test}
      </Button>
      <TestResult result={test.trial} />
    </div>
  );
}

function ModelsInner() {
  const { t, fmt, dateTime, errorText, fieldError } = useI18n();
  const toast = useToast();
  const data = useAsync(() => api.get<AiModelSettings>('v1/admin/ai/model'), []);
  const [values, setValues] = useState<Record<string, Value>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const refresh = useTrial();

  useEffect(() => {
    if (data.data) setValues(Object.fromEntries(data.data.settings.fields.map((f) => [f.key, f.value])));
  }, [data.data]);

  const fields = useMemo(() => new Map((data.data?.settings.fields ?? []).map((f) => [f.key, f])), [data.data]);
  const models = data.data?.availableModels ?? [];
  const changed = (data.data?.settings.fields ?? []).filter((f) => (values[f.key] ?? null) !== (f.value ?? null));
  const problems = Object.fromEntries(changed.map((f) => [f.key, problem(f, values[f.key] ?? null, models)]));
  const invalid = changed.some((f) => problems[f.key]);
  const label = (key: string) => (t.ai.fields as Record<string, string>)[key] ?? key;
  const set = (key: string, value: Value) => setValues((s) => ({ ...s, [key]: value }));
  const text = (key: string) => (typeof values[key] === 'string' ? (values[key] as string) : null);

  const save = async () => {
    setSaving(true);
    setServerErrors({});
    try {
      await api.put('v1/admin/ai/model', { values: Object.fromEntries(changed.map((f) => [f.key, values[f.key] === '' ? null : (values[f.key] ?? null)])) });
      toast.success(t.ai.modelsSaved);
      data.reload();
    } catch (error) {
      setServerErrors(fieldErrors(error, fieldError));
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const refreshList = async () => {
    try {
      const result = await refresh.run({ type: 'models' });
      if (result?.status === 'succeeded') {
        toast.success(t.ai.listRefreshed);
        data.reload();
      } else if (result?.status === 'failed') toast.error(result.error ?? t.errors.generic);
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const errorOf = (key: string) => serverErrors[key] ?? (problems[key] ? fieldError(problems[key]!) : null);

  const control = (key: string): ReactNode => {
    const f = fields.get(key);
    if (!f) return null;
    const id = `ai-${key}`;
    const value = values[key] ?? null;
    const error = errorOf(key);
    const hint = <span className="font-mono">{key}</span>;
    if (f.type === 'bool')
      return (
        <div key={key} className="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3">
          <div>
            <p className="text-[13px] font-medium">{label(key)}</p>
            <p className="font-mono text-xs text-muted">{key}</p>
          </div>
          <Toggle checked={value === true} onChange={(v) => set(key, v)} label={label(key)} />
        </div>
      );
    if (f.type === 'int')
      return (
        <Field key={key} label={label(key)} htmlFor={id} error={error} hint={<span>{fmt(t.ai.range, { min: f.min ?? 0, max: f.max ?? 0 })} · {hint}</span>}>
          <Input id={id} type="number" min={f.min ?? undefined} max={f.max ?? undefined} value={value === null ? '' : String(value)} invalid={!!error}
            onChange={(e) => set(key, e.target.value === '' ? null : Number(e.target.value))} />
        </Field>
      );
    if (f.type === 'operationList') {
      const selected = new Set((text(key) ?? '').split(',').map((s) => s.trim()).filter(Boolean));
      return (
        <Field key={key} label={label(key)} error={error} hint={hint}>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {(f.options ?? []).map((op) => (
              <label key={op} className="flex items-center gap-2 text-[13px]">
                <Checkbox
                  label={op}
                  checked={selected.has(op)}
                  onChange={(v) => {
                    const next = new Set(selected);
                    if (v) next.add(op);
                    else next.delete(op);
                    set(key, (f.options ?? []).filter((o) => next.has(o)).join(','));
                  }}
                />
                {(t.ai.operations as Record<string, string>)[op] ?? op}
              </label>
            ))}
          </div>
        </Field>
      );
    }
    const options = f.type === 'model' ? [...new Set([...(typeof f.value === 'string' ? [f.value] : []), ...models])] : (f.options ?? []);
    return (
      <Field key={key} label={label(key)} htmlFor={id} error={error} hint={hint}>
        <div className="flex flex-wrap items-center gap-2">
          <Select id={id} className="min-w-0 flex-1" value={value === null ? '' : String(value)} onChange={(e) => set(key, e.target.value === '' ? null : e.target.value)}>
            {(f.nullable || value === null) && <option value="">{f.nullable ? t.ai.notSet : '—'}</option>}
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
                {f.type === 'model' && models.length > 0 && !models.includes(o) ? ` (${t.ai.notInList})` : ''}
              </option>
            ))}
          </Select>
          {f.type === 'model' && (
            <TestButton model={text(key)} kind={key === 'ImageModel' ? 'image' : 'text'} effort={key === 'ImageModel' ? null : text('ReasoningEffort.Default')} tier={key === 'ImageModel' ? null : text('ServiceTier')} />
          )}
        </div>
      </Field>
    );
  };

  if (data.error)
    return (
      <Card>
        <ErrorState error={data.error} onRetry={data.reload} />
      </Card>
    );
  if (!data.data)
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-xl" />
        ))}
      </div>
    );

  const fastOps = new Set((text('FastTextOperations') ?? '').split(',').map((s) => s.trim()));
  const operations = (fields.get('FastTextOperations')?.options ?? []) as string[];
  const defaultEffort = text('ReasoningEffort.Default');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs text-muted">
          <Icon name="info" className="h-4 w-4" />
          {fmt(t.ai.reloadHint, { seconds: data.data.reloadSeconds })} · <span className="font-mono">{data.data.settings.parameters.join(' · ')}</span>
        </p>
        <div className="flex items-center gap-2">
          {changed.length > 0 && <Badge tone="amber">{fmt(t.ai.changed, { count: changed.length })}</Badge>}
          <Button icon="check" disabled={!changed.length || invalid} loading={saving} onClick={() => void save()}>
            {t.ai.saveModels}
          </Button>
        </div>
      </div>

      <Card
        title={t.ai.allowList}
        subtitle={models.length ? fmt(t.ai.allowListHint, { count: models.length, date: dateTime(data.data.modelsFetchedAt) }) : t.ai.allowListEmpty}
        actions={
          <Button size="sm" variant="secondary" icon="refresh" loading={refresh.busy} onClick={() => void refreshList()}>
            {t.ai.refreshList}
          </Button>
        }
      >
        {models.length ? (
          <div className="flex flex-wrap gap-1.5">
            {models.map((m) => (
              <span key={m} className="rounded bg-stone-100 px-2 py-0.5 font-mono text-xs text-stone-700">
                {m}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{t.ai.allowListEmpty}</p>
        )}
      </Card>

      <Card title={t.ai.textModels}>
        <div className="grid gap-5 md:grid-cols-2">{TEXT_FIELDS.map(control)}</div>
        {!text('FastTextModel') && <p className="mt-3 text-xs text-muted">{t.ai.fastModelUnset}</p>}
      </Card>

      <Card title={t.ai.reasoning} subtitle={t.ai.reasoningHint} padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-stone-50/60 text-xs font-medium text-muted">
                <th className="px-4 py-3 font-medium">{t.ai.operation}</th>
                <th className="px-4 py-3 font-medium">{t.ai.usesModel}</th>
                <th className="px-4 py-3 font-medium">{t.ai.effort}</th>
                <th className="px-4 py-3 font-medium">{t.ai.test}</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((op) => {
                const key = `ReasoningEffort.${op}`;
                const f = fields.get(key);
                const model = fastOps.has(op) && text('FastTextModel') ? text('FastTextModel') : text('TextModel');
                const effort = text(key) ?? defaultEffort;
                const error = errorOf(key);
                return (
                  <tr key={op} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-3">
                      <p className="text-[13px]">{(t.ai.operations as Record<string, string>)[op] ?? op}</p>
                      <p className="font-mono text-xs text-muted">{op}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{model ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Select aria-label={`${t.ai.effort} ${op}`} className="w-44" value={text(key) ?? ''} onChange={(e) => set(key, e.target.value === '' ? null : e.target.value)}>
                        <option value="">{fmt(t.ai.inherit, { value: defaultEffort ?? t.ai.notSet })}</option>
                        {(f?.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </Select>
                      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <TestButton model={model} kind="text" effort={effort} tier={text('ServiceTier')} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={t.ai.imageModels} subtitle={t.ai.testImageHint}>
        <div className="grid gap-5 md:grid-cols-2">{IMAGE_FIELDS.map(control)}</div>
      </Card>

      <Card title={t.ai.safety} subtitle={t.ai.safetyHint}>
        <div className="grid gap-5 md:grid-cols-2">{SAFETY_FIELDS.map(control)}</div>
      </Card>
    </div>
  );
}

function ModelsPage() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader title={t.ai.modelsTitle} subtitle={t.ai.modelsSubtitle} />
      <ModelsInner />
    </div>
  );
}

export default function AiModelsPage() {
  return (
    <RequirePermission permission="ai.manage">
      <ModelsPage />
    </RequirePermission>
  );
}
