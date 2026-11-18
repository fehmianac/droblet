'use client';

import { useMemo, useState } from 'react';
import { RequirePermission } from '@/components/Shell';
import { emptyToNull, fieldErrors, ImageField, LocalizedField, splitList } from '@/components/forms';
import { Icon } from '@/components/icons';
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  DataTable,
  Drawer,
  ErrorState,
  Field,
  IconButton,
  Input,
  PageHeader,
  Select,
  TableSkeleton,
  Toggle,
  useAsync,
  useToast,
  type Column,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { resolveText } from '@/lib/text';
import { FABRICS, ITEM_CATEGORIES, SEASONS, type AdminLibraryItem, type ItemCategory, type Localized, type Season } from '@/lib/types';

interface Form {
  id: string;
  name: Localized;
  category: ItemCategory;
  colorIds: string;
  fabric: string;
  seasons: Season[];
  imageUrl: string | null;
  sortOrder: string;
  retired: boolean;
}

function LibraryInner() {
  const { t, lang, errorText, fieldError } = useI18n();
  const toast = useToast();
  const list = useAsync(() => api.get<AdminLibraryItem[]>('v1/admin/library'), []);
  const [category, setCategory] = useState<ItemCategory | ''>('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [retiring, setRetiring] = useState<AdminLibraryItem | null>(null);

  const rows = useMemo(() => {
    const text = q.trim().toLocaleLowerCase();
    return (list.data ?? []).filter(
      (i) => (!category || i.category === category) && (!text || `${i.id} ${Object.values(i.name).join(' ')}`.toLocaleLowerCase().includes(text)),
    );
  }, [list.data, category, q]);
  const hasSeed = (list.data ?? []).some((i) => !i.stored);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const open = (i: AdminLibraryItem | null) => {
    setErrors({});
    setIsNew(!i);
    setForm(
      i
        ? {
            id: i.id,
            name: i.name,
            category: i.category,
            colorIds: i.colorIds.join(', '),
            fabric: i.fabric ?? '',
            seasons: i.seasons,
            imageUrl: i.imageUrl,
            sortOrder: String(i.sortOrder),
            retired: i.retired,
          }
        : { id: 'lib-', name: {}, category: 'top', colorIds: '', fabric: '', seasons: [], imageUrl: null, sortOrder: '0', retired: false },
    );
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setErrors({});
    try {
      await api.put(`v1/admin/library/${encodeURIComponent(form.id.trim())}`, {
        name: emptyToNull(form.name),
        category: form.category,
        colorIds: splitList(form.colorIds).map((c) => c.toLowerCase()),
        fabric: form.fabric || null,
        seasons: form.seasons,
        imageUrl: form.imageUrl,
        sortOrder: Number(form.sortOrder) || 0,
        retired: form.retired,
      });
      toast.success(t.common.saved);
      setForm(null);
      list.reload();
    } catch (error) {
      setErrors(fieldErrors(error, fieldError));
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const retire = async () => {
    if (!retiring) return;
    setBusy(true);
    try {
      await api.del(`v1/admin/library/${encodeURIComponent(retiring.id)}`);
      toast.success(t.common.retiredDone);
      setRetiring(null);
      list.reload();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<AdminLibraryItem>[] = [
    {
      key: 'name',
      header: t.common.name,
      sortValue: (i) => resolveText(i.name, lang),
      render: (i) => (
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-stone-50 text-stone-400">
            {i.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={i.imageUrl} alt="" className="h-full w-full object-contain" loading="lazy" />
            ) : (
              <Icon name="image" className="h-4 w-4" />
            )}
          </span>
          <div>
            <p className="font-medium">{resolveText(i.name, lang)}</p>
            <p className="font-mono text-xs text-muted">{i.id}</p>
          </div>
        </div>
      ),
    },
    { key: 'category', header: t.library.category, sortValue: (i) => i.category, render: (i) => t.enums.itemCategory[i.category] ?? i.category },
    { key: 'colors', header: t.library.colors, render: (i) => <span className="text-xs text-muted">{i.colorIds.join(', ')}</span> },
    { key: 'fabric', header: t.library.fabric, render: (i) => (i.fabric ? ((t.enums.fabric as Record<string, string>)[i.fabric] ?? i.fabric) : '—') },
    { key: 'seasons', header: t.library.seasons, render: (i) => <span className="text-xs">{i.seasons.map((s) => t.enums.season[s]).join(', ')}</span> },
    { key: 'order', header: t.common.sortOrder, sortValue: (i) => i.sortOrder, render: (i) => i.sortOrder },
    {
      key: 'status',
      header: t.common.status,
      render: (i) => (
        <div className="flex gap-1">
          {i.retired ? <Badge>{t.common.retired}</Badge> : <Badge tone="green">{t.common.active}</Badge>}
          {!i.stored && <Badge tone="blue">{t.library.seed}</Badge>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t.common.actions}</span>,
      className: 'text-right',
      render: (i) => (
        <div className="flex justify-end gap-1">
          <IconButton icon="pencil" label={t.common.edit} onClick={() => open(i)} />
          {!i.retired && <IconButton icon="trash" label={t.common.retire} onClick={() => setRetiring(i)} />}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t.library.title}
        subtitle={t.library.subtitle}
        actions={
          <Button icon="plus" onClick={() => open(null)}>
            {t.library.newItem}
          </Button>
        }
      />
      {hasSeed && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
          {t.library.seedHint}
        </p>
      )}
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.common.search} aria-label={t.common.search} className="max-w-xs" />
          <Select value={category} onChange={(e) => setCategory(e.target.value as ItemCategory | '')} aria-label={t.library.category} className="w-48">
            <option value="">{t.common.all}</option>
            {ITEM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t.enums.itemCategory[c]}
              </option>
            ))}
          </Select>
        </div>
        {list.loading ? <TableSkeleton /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : <DataTable columns={columns} rows={rows} rowKey={(i) => i.id} />}
      </Card>
      <Drawer
        open={!!form}
        title={isNew ? t.library.newItem : t.library.editItem}
        onClose={() => setForm(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              {t.common.cancel}
            </Button>
            <Button loading={busy} onClick={() => void save()}>
              {t.common.save}
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            <Field label={t.common.id} htmlFor="li-id" required hint={t.library.idHint} error={errors.id}>
              <Input id="li-id" value={form.id} disabled={!isNew} onChange={(e) => set('id', e.target.value.toLowerCase())} className="font-mono" />
            </Field>
            <LocalizedField id="li-name" label={t.common.name} required value={form.name} onChange={(v) => set('name', v)} maxLength={80} error={errors.name} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.library.category} htmlFor="li-cat" required error={errors.category}>
                <Select id="li-cat" value={form.category} onChange={(e) => set('category', e.target.value as ItemCategory)}>
                  {ITEM_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t.enums.itemCategory[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.library.fabric} htmlFor="li-fabric" error={errors.fabric}>
                <Select id="li-fabric" value={form.fabric} onChange={(e) => set('fabric', e.target.value)}>
                  <option value="">—</option>
                  {FABRICS.map((f) => (
                    <option key={f} value={f}>
                      {t.enums.fabric[f]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={t.library.colors} htmlFor="li-colors" required hint={t.library.colorsHint} error={errors.colorIds}>
              <Input id="li-colors" value={form.colorIds} onChange={(e) => set('colorIds', e.target.value)} />
            </Field>
            <Field label={t.library.seasons} required error={errors.seasons}>
              <div className="flex flex-wrap gap-2">
                {SEASONS.map((s) => {
                  const on = form.seasons.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set('seasons', on ? form.seasons.filter((x) => x !== s) : [...form.seasons, s])}
                      className={`rounded-full border px-3 py-1 text-sm ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line text-ink hover:bg-stone-50'}`}
                    >
                      {t.enums.season[s]}
                    </button>
                  );
                })}
              </div>
            </Field>
            <ImageField id="li-img" label={t.common.image} value={form.imageUrl} onChange={(v) => set('imageUrl', v)} purpose="library" error={errors.imageUrl} />
            <Field label={t.common.sortOrder} htmlFor="li-order">
              <Input id="li-order" type="number" value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
            </Field>
            <label className="flex items-center gap-3 text-sm">
              <Toggle checked={form.retired} onChange={(v) => set('retired', v)} label={t.common.retired} />
              {t.common.retired}
            </label>
          </div>
        )}
      </Drawer>
      <ConfirmModal
        open={!!retiring}
        title={`${t.common.retire}: ${retiring ? resolveText(retiring.name, lang) : ''}`}
        body={t.common.retireConfirm}
        confirmLabel={t.common.retire}
        danger
        busy={busy}
        onClose={() => setRetiring(null)}
        onConfirm={() => void retire()}
      />
    </div>
  );
}

export default function LibraryPage() {
  return (
    <RequirePermission permission="content.manage">
      <LibraryInner />
    </RequirePermission>
  );
}
