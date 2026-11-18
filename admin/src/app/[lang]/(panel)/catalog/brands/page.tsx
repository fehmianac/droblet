'use client';

import { useMemo, useState } from 'react';
import { RequirePermission } from '@/components/Shell';
import { fieldErrors, ImageField } from '@/components/forms';
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
import type { AdminBrand, AffiliateSource } from '@/lib/types';

interface Form {
  id: string;
  name: string;
  websiteUrl: string;
  logoUrl: string | null;
  source: AffiliateSource;
  network: string;
  checkoutUrl: string;
  clickIdParameter: string;
  commissionRateBps: string;
  retired: boolean;
}

const blank: Form = {
  id: '',
  name: '',
  websiteUrl: '',
  logoUrl: null,
  source: 'network',
  network: '',
  checkoutUrl: '',
  clickIdParameter: '',
  commissionRateBps: '',
  retired: false,
};

function toForm(b: AdminBrand): Form {
  return {
    id: b.id,
    name: b.name,
    websiteUrl: b.websiteUrl ?? '',
    logoUrl: b.logoUrl,
    source: b.source,
    network: b.network ?? '',
    checkoutUrl: b.checkoutUrl ?? '',
    clickIdParameter: b.clickIdParameter ?? '',
    commissionRateBps: b.commissionRateBps === null ? '' : String(b.commissionRateBps),
    retired: b.retired,
  };
}

function BrandsInner() {
  const { t, date, errorText, fieldError } = useI18n();
  const toast = useToast();
  const list = useAsync(() => api.get<AdminBrand[]>('v1/admin/brand'), []);
  const [q, setQ] = useState('');
  const [showRetired, setShowRetired] = useState(true);
  const [form, setForm] = useState<Form | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [retiring, setRetiring] = useState<AdminBrand | null>(null);

  const rows = useMemo(() => {
    const text = q.trim().toLocaleLowerCase();
    return (list.data ?? []).filter((b) => (showRetired || !b.retired) && (!text || `${b.id} ${b.name} ${b.network ?? ''}`.toLocaleLowerCase().includes(text)));
  }, [list.data, q, showRetired]);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setErrors({});
    try {
      await api.put(`v1/admin/brand/${encodeURIComponent(form.id.trim())}`, {
        name: form.name.trim(),
        websiteUrl: form.websiteUrl.trim() || null,
        logoUrl: form.logoUrl,
        source: form.source,
        network: form.network.trim() || null,
        checkoutUrl: form.checkoutUrl.trim() || null,
        clickIdParameter: form.clickIdParameter.trim() || null,
        commissionRateBps: form.commissionRateBps.trim() === '' ? null : Number(form.commissionRateBps),
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
      await api.del(`v1/admin/brand/${encodeURIComponent(retiring.id)}`);
      toast.success(t.common.retiredDone);
      setRetiring(null);
      list.reload();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<AdminBrand>[] = [
    {
      key: 'name',
      header: t.common.name,
      sortValue: (b) => b.name.toLocaleLowerCase(),
      render: (b) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-stone-50 text-xs font-semibold text-muted">
            {b.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.logoUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              b.name.slice(0, 2)
            )}
          </span>
          <div>
            <p className="font-medium text-ink">{b.name}</p>
            <p className="font-mono text-xs text-muted">{b.id}</p>
          </div>
        </div>
      ),
    },
    { key: 'source', header: t.brands.source, sortValue: (b) => b.source, render: (b) => <Badge tone={b.source === 'direct' ? 'blue' : 'brand'}>{t.enums.source[b.source]}</Badge> },
    { key: 'network', header: t.brands.network, render: (b) => b.network ?? '—' },
    {
      key: 'commission',
      header: t.brands.commission,
      sortValue: (b) => b.commissionRateBps ?? -1,
      render: (b) => (b.commissionRateBps === null ? '—' : `${(b.commissionRateBps / 100).toFixed(2)}%`),
    },
    { key: 'status', header: t.common.status, render: (b) => (b.retired ? <Badge>{t.common.retired}</Badge> : <Badge tone="green">{t.common.active}</Badge>) },
    { key: 'updated', header: t.common.updatedAt, sortValue: (b) => b.updatedAt, render: (b) => <span className="text-muted">{date(b.updatedAt)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">{t.common.actions}</span>,
      className: 'text-right',
      render: (b) => (
        <div className="flex justify-end gap-1">
          <IconButton
            icon="pencil"
            label={t.common.edit}
            onClick={() => {
              setIsNew(false);
              setErrors({});
              setForm(toForm(b));
            }}
          />
          {!b.retired && <IconButton icon="trash" label={t.common.retire} onClick={() => setRetiring(b)} />}
        </div>
      ),
    },
  ];

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  return (
    <div>
      <PageHeader
        title={t.brands.title}
        subtitle={t.brands.subtitle}
        actions={
          <Button
            icon="plus"
            onClick={() => {
              setIsNew(true);
              setErrors({});
              setForm({ ...blank });
            }}
          >
            {t.brands.newBrand}
          </Button>
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <div className="relative w-full max-w-xs">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400">
              <Icon name="search" className="h-4 w-4" />
            </span>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.brands.searchPlaceholder} aria-label={t.common.search} className="pl-9" />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            <Toggle checked={showRetired} onChange={setShowRetired} label={t.common.showRetired} />
            {t.common.showRetired}
          </label>
        </div>
        {list.loading ? <TableSkeleton /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : <DataTable columns={columns} rows={rows} rowKey={(b) => b.id} />}
      </Card>

      <Drawer
        open={!!form}
        title={isNew ? t.brands.newBrand : t.brands.editBrand}
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
            <Field label={t.common.id} htmlFor="brand-id" required hint={t.brands.idHint} error={errors.id}>
              <Input id="brand-id" value={form.id} disabled={!isNew} onChange={(e) => set('id', e.target.value.toLowerCase())} className="font-mono" />
            </Field>
            <Field label={t.common.name} htmlFor="brand-name" required error={errors.name}>
              <Input id="brand-name" value={form.name} maxLength={80} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.brands.source} htmlFor="brand-source" error={errors.source}>
                <Select id="brand-source" value={form.source} onChange={(e) => set('source', e.target.value as AffiliateSource)}>
                  <option value="network">{t.enums.source.network}</option>
                  <option value="direct">{t.enums.source.direct}</option>
                </Select>
              </Field>
              <Field label={t.brands.network} htmlFor="brand-network" hint={t.brands.networkHint} error={errors.network}>
                <Input id="brand-network" value={form.network} maxLength={40} onChange={(e) => set('network', e.target.value)} />
              </Field>
            </div>
            <Field label={t.brands.commission} htmlFor="brand-commission" hint={t.brands.commissionHint} error={errors.commissionRateBps}>
              <Input id="brand-commission" type="number" min={0} max={5000} value={form.commissionRateBps} onChange={(e) => set('commissionRateBps', e.target.value)} />
            </Field>
            <Field label={t.brands.websiteUrl} htmlFor="brand-web" error={errors.websiteUrl}>
              <Input id="brand-web" type="url" placeholder="https://" value={form.websiteUrl} onChange={(e) => set('websiteUrl', e.target.value)} />
            </Field>
            <Field label={t.brands.checkoutUrl} htmlFor="brand-checkout" error={errors.checkoutUrl}>
              <Input id="brand-checkout" type="url" placeholder="https://" value={form.checkoutUrl} onChange={(e) => set('checkoutUrl', e.target.value)} />
            </Field>
            <Field label={t.brands.clickIdParameter} htmlFor="brand-click" hint={t.brands.clickIdHint} error={errors.clickIdParameter}>
              <Input id="brand-click" value={form.clickIdParameter} onChange={(e) => set('clickIdParameter', e.target.value)} className="font-mono" />
            </Field>
            <ImageField id="brand-logo" label={t.brands.logoUrl} value={form.logoUrl} onChange={(v) => set('logoUrl', v)} purpose="brand" error={errors.logoUrl} />
            <label className="flex items-center gap-3 text-sm">
              <Toggle checked={form.retired} onChange={(v) => set('retired', v)} label={t.common.retired} />
              {t.common.retired}
            </label>
          </div>
        )}
      </Drawer>

      <ConfirmModal
        open={!!retiring}
        title={`${t.common.retire}: ${retiring?.name ?? ''}`}
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

export default function BrandsPage() {
  return (
    <RequirePermission permission="catalog.manage">
      <BrandsInner />
    </RequirePermission>
  );
}
