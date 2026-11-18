'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { RequirePermission } from '@/components/Shell';
import { emptyToNull, fieldErrors, ImageField, LocalizedField } from '@/components/forms';
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
  Tabs,
  Toggle,
  useAsync,
  useToast,
  type Column,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { resolveText } from '@/lib/text';
import { COLLECTION_KINDS, type AdminCollection, type CollectionKind, type Localized } from '@/lib/types';

interface Form {
  id: string;
  title: Localized;
  subtitle: Localized;
  imageUrl: string | null;
  sortOrder: string;
  sponsorName: Localized;
  retired: boolean;
}

function CollectionsInner() {
  const { t, lang, href, date, errorText, fieldError } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const initial = useSearchParams().get('kind');
  const [kind, setKind] = useState<CollectionKind>(initial === 'series' ? 'series' : 'creator');
  const list = useAsync(() => api.get<AdminCollection[]>(`v1/admin/collection/${kind}`), [kind]);
  const [form, setForm] = useState<Form | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [retiring, setRetiring] = useState<AdminCollection | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const open = (c: AdminCollection | null) => {
    setErrors({});
    setIsNew(!c);
    setForm(
      c
        ? { id: c.id, title: c.title, subtitle: c.subtitle ?? {}, imageUrl: c.imageUrl, sortOrder: String(c.sortOrder), sponsorName: c.sponsorName ?? {}, retired: c.retired }
        : { id: '', title: {}, subtitle: {}, imageUrl: null, sortOrder: '0', sponsorName: {}, retired: false },
    );
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setErrors({});
    try {
      await api.put(`v1/admin/collection/${kind}/${encodeURIComponent(form.id.trim())}`, {
        title: emptyToNull(form.title),
        subtitle: emptyToNull(form.subtitle),
        imageUrl: form.imageUrl,
        sortOrder: Number(form.sortOrder) || 0,
        sponsorName: emptyToNull(form.sponsorName),
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
      await api.del(`v1/admin/collection/${kind}/${encodeURIComponent(retiring.id)}`);
      toast.success(t.common.retiredDone);
      setRetiring(null);
      list.reload();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<AdminCollection>[] = [
    {
      key: 'title',
      header: t.collections.titleLabel,
      sortValue: (c) => resolveText(c.title, lang),
      render: (c) => (
        <div className="flex items-center gap-3">
          <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-line bg-stone-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {c.imageUrl && <img src={c.imageUrl} alt="" className="h-full w-full object-cover" />}
          </span>
          <div>
            <p className="font-medium">{resolveText(c.title, lang)}</p>
            <p className="font-mono text-xs text-muted">{c.id}</p>
          </div>
        </div>
      ),
    },
    { key: 'order', header: t.common.sortOrder, sortValue: (c) => c.sortOrder, render: (c) => c.sortOrder },
    {
      key: 'status',
      header: t.common.status,
      render: (c) => (
        <div className="flex gap-1">
          {c.retired ? <Badge>{t.common.retired}</Badge> : <Badge tone="green">{t.common.active}</Badge>}
          {c.sponsorName && <Badge tone="blue">{t.edits.sponsored}</Badge>}
        </div>
      ),
    },
    { key: 'updated', header: t.common.updatedAt, sortValue: (c) => c.updatedAt, render: (c) => <span className="text-muted">{date(c.updatedAt)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">{t.common.actions}</span>,
      className: 'text-right',
      render: (c) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="subtle" icon="layers" onClick={() => router.push(href(`/content/collections/looks/?kind=${kind}&id=${encodeURIComponent(c.id)}`))}>
            {t.collections.manageLooks}
          </Button>
          <IconButton icon="pencil" label={t.common.edit} onClick={() => open(c)} />
          {!c.retired && <IconButton icon="trash" label={t.common.retire} onClick={() => setRetiring(c)} />}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t.collections.title}
        subtitle={t.collections.subtitle}
        actions={
          <Button icon="plus" onClick={() => open(null)}>
            {t.collections.newCollection}
          </Button>
        }
      />
      <Card padded={false}>
        <div className="px-5 pt-2">
          <Tabs label={t.collections.kind} value={kind} onChange={setKind} tabs={COLLECTION_KINDS.map((k) => ({ id: k, label: t.enums.collectionKind[k] }))} />
        </div>
        {list.loading ? <TableSkeleton /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : <DataTable columns={columns} rows={list.data ?? []} rowKey={(c) => c.id} />}
      </Card>
      <Drawer
        open={!!form}
        title={isNew ? t.collections.newCollection : t.collections.editCollection}
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
            <Badge tone="brand">{t.enums.collectionKind[kind]}</Badge>
            <Field label={t.common.id} htmlFor="c-id" required hint={t.brands.idHint} error={errors.id}>
              <Input id="c-id" value={form.id} disabled={!isNew} onChange={(e) => set('id', e.target.value.toLowerCase())} className="font-mono" />
            </Field>
            <LocalizedField id="c-title" label={t.collections.titleLabel} required value={form.title} onChange={(v) => set('title', v)} maxLength={120} error={errors.title} />
            <LocalizedField id="c-sub" label={t.collections.subtitleLabel} value={form.subtitle} onChange={(v) => set('subtitle', v)} maxLength={240} error={errors.subtitle} />
            <ImageField id="c-img" label={t.common.image} value={form.imageUrl} onChange={(v) => set('imageUrl', v)} purpose="collection" error={errors.imageUrl} />
            <Field label={t.common.sortOrder} htmlFor="c-order" error={errors.sortOrder}>
              <Input id="c-order" type="number" value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
            </Field>
            <LocalizedField id="c-sponsor" label={t.collections.sponsorName} value={form.sponsorName} onChange={(v) => set('sponsorName', v)} maxLength={80} error={errors.sponsorName} />
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

export default function CollectionsPage() {
  return (
    <RequirePermission permission="content.manage">
      <CollectionsInner />
    </RequirePermission>
  );
}
