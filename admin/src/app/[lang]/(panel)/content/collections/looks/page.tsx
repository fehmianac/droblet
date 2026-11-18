'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { RequirePermission } from '@/components/Shell';
import { emptyToNull, fieldErrors, ImageField, LinkButton, LocalizedField, splitList } from '@/components/forms';
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
  TableSkeleton,
  Toggle,
  useAsync,
  useToast,
  type Column,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { resolveText } from '@/lib/text';
import type { AdminCollection, AdminCollectionLook, CollectionKind, Localized } from '@/lib/types';

interface Form {
  id: string;
  title: Localized;
  note: Localized;
  imageUrl: string | null;
  productIds: string;
  sortOrder: string;
  retired: boolean;
}

function LooksInner() {
  const { t, lang, fmt, href, errorText, fieldError } = useI18n();
  const toast = useToast();
  const params = useSearchParams();
  const kind = (params.get('kind') === 'series' ? 'series' : 'creator') as CollectionKind;
  const id = params.get('id') ?? '';
  const base = `v1/admin/collection/${kind}/${encodeURIComponent(id)}`;
  const collection = useAsync(async () => (await api.get<AdminCollection[]>(`v1/admin/collection/${kind}`)).find((c) => c.id === id) ?? null, [kind, id]);
  const list = useAsync(() => api.get<AdminCollectionLook[]>(`${base}/look`), [base]);
  const [form, setForm] = useState<Form | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [retiring, setRetiring] = useState<AdminCollectionLook | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const open = (l: AdminCollectionLook | null) => {
    setErrors({});
    setIsNew(!l);
    setForm(
      l
        ? { id: l.id, title: l.title, note: l.note ?? {}, imageUrl: l.imageUrl, productIds: l.productIds.join(', '), sortOrder: String(l.sortOrder), retired: l.retired }
        : { id: '', title: {}, note: {}, imageUrl: null, productIds: '', sortOrder: '0', retired: false },
    );
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setErrors({});
    try {
      await api.put(`${base}/look/${encodeURIComponent(form.id.trim())}`, {
        title: emptyToNull(form.title),
        note: emptyToNull(form.note),
        imageUrl: form.imageUrl,
        productIds: splitList(form.productIds),
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
      await api.del(`${base}/look/${encodeURIComponent(retiring.id)}`);
      toast.success(t.common.retiredDone);
      setRetiring(null);
      list.reload();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<AdminCollectionLook>[] = [
    {
      key: 'title',
      header: t.collections.titleLabel,
      render: (l) => (
        <div className="flex items-center gap-3">
          <span className="h-12 w-10 shrink-0 overflow-hidden rounded-md border border-line bg-stone-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {l.imageUrl && <img src={l.imageUrl} alt="" className="h-full w-full object-cover" />}
          </span>
          <div>
            <p className="font-medium">{resolveText(l.title, lang)}</p>
            <p className="font-mono text-xs text-muted">{l.id}</p>
          </div>
        </div>
      ),
    },
    { key: 'products', header: t.collections.productIds, render: (l) => <span className="font-mono text-xs text-muted">{l.productIds.join(', ') || '—'}</span> },
    { key: 'order', header: t.common.sortOrder, sortValue: (l) => l.sortOrder, render: (l) => l.sortOrder },
    { key: 'status', header: t.common.status, render: (l) => (l.retired ? <Badge>{t.common.retired}</Badge> : <Badge tone="green">{t.common.active}</Badge>) },
    {
      key: 'actions',
      header: <span className="sr-only">{t.common.actions}</span>,
      className: 'text-right',
      render: (l) => (
        <div className="flex justify-end gap-1">
          <IconButton icon="pencil" label={t.common.edit} onClick={() => open(l)} />
          {!l.retired && <IconButton icon="trash" label={t.common.retire} onClick={() => setRetiring(l)} />}
        </div>
      ),
    },
  ];

  const name = collection.data ? resolveText(collection.data.title, lang) : id;

  return (
    <div>
      <PageHeader
        title={fmt(t.collections.looksOf, { name })}
        subtitle={<Badge tone="brand">{t.enums.collectionKind[kind]}</Badge>}
        actions={
          <>
            <LinkButton href={href(`/content/collections/?kind=${kind}`)} variant="secondary" icon="chevronLeft">
              {t.common.back}
            </LinkButton>
            <Button icon="plus" onClick={() => open(null)}>
              {t.collections.newLook}
            </Button>
          </>
        }
      />
      <Card padded={false}>
        {list.loading ? <TableSkeleton /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : <DataTable columns={columns} rows={list.data ?? []} rowKey={(l) => l.id} />}
      </Card>
      <Drawer
        open={!!form}
        title={isNew ? t.collections.newLook : t.collections.editLook}
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
            <Field label={t.common.id} htmlFor="cl-id" required hint={t.brands.idHint} error={errors.id}>
              <Input id="cl-id" value={form.id} disabled={!isNew} onChange={(e) => set('id', e.target.value.toLowerCase())} className="font-mono" />
            </Field>
            <LocalizedField id="cl-title" label={t.collections.titleLabel} required value={form.title} onChange={(v) => set('title', v)} maxLength={120} error={errors.title} />
            <LocalizedField id="cl-note" label={t.collections.note} multiline value={form.note} onChange={(v) => set('note', v)} maxLength={600} error={errors.note} />
            <ImageField id="cl-img" label={t.common.image} value={form.imageUrl} onChange={(v) => set('imageUrl', v)} purpose="collection" error={errors.imageUrl} />
            <Field label={t.collections.productIds} htmlFor="cl-products" hint={t.collections.productIdsHint} error={errors.productIds}>
              <Input id="cl-products" value={form.productIds} onChange={(e) => set('productIds', e.target.value)} className="font-mono text-xs" />
            </Field>
            <Field label={t.common.sortOrder} htmlFor="cl-order">
              <Input id="cl-order" type="number" value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
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
        title={`${t.common.retire}: ${retiring ? resolveText(retiring.title, lang) : ''}`}
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

export default function CollectionLooksPage() {
  return (
    <RequirePermission permission="content.manage">
      <LooksInner />
    </RequirePermission>
  );
}
