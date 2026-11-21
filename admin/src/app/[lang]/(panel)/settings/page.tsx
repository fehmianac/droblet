'use client';

import { useEffect, useState } from 'react';
import { RequirePermission } from '@/components/Shell';
import { fieldErrors } from '@/components/forms';
import { Icon } from '@/components/icons';
import { Button, Card, ErrorState, Field, Input, PageHeader, Skeleton, Toggle, useAsync, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { SettingField, SettingGroup } from '@/lib/types';

type Value = number | boolean | string | null;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAY_TIME = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([01]\d|2[0-3]):[0-5]\d$/;

function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$|^UTC$/.test(zone);
  } catch {
    return false;
  }
}

/** Mirrors the server rules for each field type; the server validates again. */
function validateField(field: SettingField, value: Value): 'out_of_range' | 'invalid' | null {
  switch (field.type) {
    case 'int': {
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'invalid';
      if ((field.min !== null && field.min !== undefined && value < field.min) || (field.max !== null && field.max !== undefined && value > field.max)) return 'out_of_range';
      return null;
    }
    case 'bool':
      return typeof value === 'boolean' ? null : 'invalid';
    case 'time':
      return typeof value === 'string' && TIME.test(value) ? null : 'invalid';
    case 'weekdayTime':
      return typeof value === 'string' && WEEKDAY_TIME.test(value) ? null : 'invalid';
    case 'timeZone':
      return typeof value === 'string' && isValidZone(value) ? null : 'invalid';
  }
}

function GroupCard({ group, onSaved }: { group: SettingGroup; onSaved: (g: SettingGroup) => void }) {
  const { t, fmt, errorText, fieldError } = useI18n();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, Value>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValues(Object.fromEntries(group.fields.map((f) => [f.key, f.value])));
  }, [group]);

  const changed = group.fields.filter((f) => values[f.key] !== f.value);
  const problems = Object.fromEntries(group.fields.map((f) => [f.key, validateField(f, values[f.key] ?? null)]));
  const invalid = changed.some((f) => problems[f.key]);
  // Group-specific labels first (the same key, e.g. "Enabled", means different things in different groups).
  const groupFields = (t.settings.groupFields as Record<string, Record<string, string> | undefined>)[group.group];
  const groupHelp = (t.settings.fieldHelp as Record<string, Record<string, string> | undefined>)[group.group];
  const label = (key: string) => groupFields?.[key] ?? (t.settings.fields as Record<string, string>)[key] ?? key;
  const help = (key: string) => groupHelp?.[key] ?? null;
  const note = (t.settings.groupNotes as Record<string, string | undefined>)[group.group] ?? null;
  const title = (t.settings.groups as Record<string, string>)[group.group] ?? group.group;

  const save = async () => {
    setBusy(true);
    setServerErrors({});
    try {
      const next = await api.put<SettingGroup>(`v1/admin/setting/${encodeURIComponent(group.group)}`, {
        values: Object.fromEntries(changed.map((f) => [f.key, values[f.key]])),
      });
      toast.success(t.common.saved);
      onSaved(next);
    } catch (error) {
      // Server field paths are "values.<key>" or "<key>"; normalise both.
      const errs = fieldErrors(error, fieldError);
      setServerErrors(Object.fromEntries(Object.entries(errs).map(([k, v]) => [k.replace(/^values\./, ''), v])));
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={title}
      subtitle={<span className="font-mono">{group.parameters.join(' · ')}</span>}
      actions={
        <Button size="sm" icon="check" disabled={!changed.length || invalid} loading={busy} onClick={() => void save()}>
          {t.settings.saveGroup}
        </Button>
      }
    >
      {note && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0" />
          {note}
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        {group.fields.map((f) => {
          const id = `${group.group}-${f.key}`;
          const value = values[f.key] ?? null;
          const problem = (value !== f.value && problems[f.key]) || null;
          const error = serverErrors[f.key] ?? (problem ? fieldError(problem) : null);
          const hint =
            f.type === 'int' && f.min !== null && f.min !== undefined && f.max !== null && f.max !== undefined
              ? fmt(t.settings.range, { min: f.min, max: f.max })
              : t.settings.typeHints[f.type];
          if (f.type === 'bool') {
            return (
              <div key={f.key} className="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium">{label(f.key)}</p>
                  {help(f.key) && <p className="mt-0.5 text-xs text-muted">{help(f.key)}</p>}
                  <p className="font-mono text-xs text-muted">{f.key}</p>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted">
                  {value ? t.settings.on : t.settings.off}
                  <Toggle checked={value === true} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} label={label(f.key)} />
                </div>
              </div>
            );
          }
          return (
            <Field key={f.key} label={label(f.key)} htmlFor={id} hint={
                <span>
                  {help(f.key) && <span className="block">{help(f.key)}</span>}
                  {hint} · <span className="font-mono">{f.key}</span>
                </span>
              } error={error}>
              <Input
                id={id}
                type={f.type === 'int' ? 'number' : 'text'}
                min={f.min ?? undefined}
                max={f.max ?? undefined}
                value={value === null ? '' : String(value)}
                invalid={!!error}
                onChange={(e) => {
                  const raw = e.target.value;
                  setValues((s) => ({ ...s, [f.key]: f.type === 'int' ? (raw === '' ? null : Number(raw)) : raw }));
                }}
              />
            </Field>
          );
        })}
      </div>
    </Card>
  );
}

function SettingsInner() {
  const { t } = useI18n();
  const groups = useAsync(() => api.get<SettingGroup[]>('v1/admin/setting'), []);

  return (
    <div>
      <PageHeader title={t.settings.title} subtitle={t.settings.subtitle} />
      <p className="mb-4 flex items-center gap-2 text-xs text-muted">
        <Icon name="shield" className="h-4 w-4" />
        {t.settings.parameters}: Parameter Store · eu-central-1
      </p>
      {groups.error ? (
        <Card>
          <ErrorState error={groups.error} onRetry={groups.reload} />
        </Card>
      ) : !groups.data ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.data.map((g) => (
            <GroupCard key={g.group} group={g} onSaved={(next) => groups.setData(groups.data!.map((x) => (x.group === next.group ? next : x)))} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <RequirePermission permission="settings.manage">
      <SettingsInner />
    </RequirePermission>
  );
}
