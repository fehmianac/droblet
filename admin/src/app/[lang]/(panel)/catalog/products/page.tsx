'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RequirePermission } from '@/components/Shell';
import { LinkButton } from '@/components/forms';
import { Icon } from '@/components/icons';
import { Badge, Button, Card, ConfirmModal, DataTable, ErrorState, Input, PageHeader, Select, TableSkeleton, Toggle, useAsync, useToast, type Column } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { resolveText } from '@/lib/text';
import type { AdminBrand, AdminProduct, Paged } from '@/lib/types';

const PAGE = 25;

function ProductsInner() {
  const { t, lang, fmt, href, date, money, number } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [brand, setBrand] = useState(params.get('brand') ?? '');
  const [includeRetired, setIncludeRetired] = useState(false);
  const [tokens, setTokens] = useState<(string | null)[]>([null]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const brands = useAsync(() => api.get<AdminBrand[]>('v1/admin/brand'), []);
  const pageToken = tokens[tokens.length - 1] ?? null;
  const page = useAsync(
    () => api.get<Paged<AdminProduct>>('v1/admin/product', { query: { q: query, brand, includeRetired, pageToken, limit: PAGE } }),
    [query, brand, includeRetired, pageToken],
  );

  useEffect(() => {
    setTokens([null]);
    setSelected(new Set());
  }, [query, brand, includeRetired]);

  // Debounced search box.
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(q.trim()), 350);
    return () => window.clearTimeout(id);
  }, [q]);

  const brandName = (id: string) => brands.data?.find((b) => b.id === id)?.name ?? id;

  const retireSelected = async () => {
    setBusy(true);
    let failed = 0;
    for (const id of selected) {
      try {
        await api.del(`v1/admin/product/${encodeURIComponent(id)}`);
      } catch {
        failed++;
      }
    }
    setBusy(false);
    setConfirm(false);
    setSelected(new Set());
    if (failed) toast.error(t.errors.generic);
    else toast.success(t.common.retiredDone);
    page.reload();
  };

  const columns: Column<AdminProduct>[] = [
    {
      key: 'name',
      header: t.common.name,
      sortValue: (p) => resolveText(p.name, lang).toLocaleLowerCase(),
      render: (p) => (
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-stone-50 text-stone-400">
            {p.images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.images[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <Icon name="image" className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{resolveText(p.name, lang)}</p>
            <p className="truncate font-mono text-xs text-muted">{p.id}</p>
          </div>
        </div>
      ),
    },
    { key: 'brand', header: t.products.brand, sortValue: (p) => brandName(p.brandId), render: (p) => brandName(p.brandId) },
    { key: 'category', header: t.products.category, render: (p) => t.enums.productCategory[p.category] ?? p.category },
    {
      key: 'price',
      header: t.products.price,
      className: 'text-right',
      sortValue: (p) => p.priceMinor,
      render: (p) => (
        <div className="text-right tabular-nums">
          <p className="font-medium">{money(p.priceMinor, p.currency)}</p>
          {p.previousPriceMinor !== null && <p className="text-xs text-muted line-through">{money(p.previousPriceMinor, p.currency)}</p>}
        </div>
      ),
    },
    { key: 'band', header: t.products.priceBand, render: (p) => <Badge tone={p.priceBand === 'luxuryTouch' ? 'amber' : 'neutral'}>{t.enums.priceBand[p.priceBand]}</Badge> },
    { key: 'status', header: t.common.status, render: (p) => (p.retired ? <Badge>{t.common.retired}</Badge> : <Badge tone="green">{t.common.active}</Badge>) },
    { key: 'updated', header: t.common.updatedAt, sortValue: (p) => p.updatedAt, render: (p) => <span className="whitespace-nowrap text-muted">{date(p.updatedAt)}</span> },
  ];

  const items = page.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title={t.products.title}
        subtitle={t.products.subtitle}
        actions={
          <>
            <LinkButton href={href('/catalog/import/')} variant="secondary" icon="upload">
              {t.products.importCsv}
            </LinkButton>
            <LinkButton href={href('/catalog/products/edit/')} icon="plus">
              {t.products.newProduct}
            </LinkButton>
          </>
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <div className="relative w-full max-w-xs">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400">
              <Icon name="search" className="h-4 w-4" />
            </span>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.products.searchPlaceholder} aria-label={t.common.search} className="pl-9" />
          </div>
          <Select value={brand} onChange={(e) => setBrand(e.target.value)} aria-label={t.products.brand} className="w-48">
            <option value="">{t.products.allBrands}</option>
            {(brands.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm text-muted">
            <Toggle checked={includeRetired} onChange={setIncludeRetired} label={t.common.showRetired} />
            {t.common.showRetired}
          </label>
          {selected.size > 0 && (
            <div className="ml-auto flex items-center gap-3 rounded-lg bg-brand-50 px-3 py-1.5 text-sm text-brand-800">
              {fmt(t.common.selected, { count: selected.size })}
              <Button size="sm" variant="danger" icon="trash" onClick={() => setConfirm(true)}>
                {t.common.retireSelected}
              </Button>
            </div>
          )}
        </div>
        {page.loading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : page.error ? (
          <ErrorState error={page.error} onRetry={page.reload} />
        ) : (
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(p) => p.id}
            selectable
            selected={selected}
            onSelectedChange={setSelected}
            onRowClick={(p) => router.push(href(`/catalog/products/edit/?id=${encodeURIComponent(p.id)}`))}
          />
        )}
        <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted">
          <span>{page.data?.count !== undefined ? fmt(t.common.rowsShown, { shown: number(items.length), total: number(page.data.count) }) : ''}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon="chevronLeft" disabled={tokens.length <= 1} onClick={() => setTokens((s) => s.slice(0, -1))}>
              {t.common.previous}
            </Button>
            <Button size="sm" variant="secondary" disabled={!page.data?.pageToken} onClick={() => setTokens((s) => [...s, page.data?.pageToken ?? null])}>
              {t.common.next}
            </Button>
          </div>
        </div>
      </Card>
      <ConfirmModal
        open={confirm}
        title={fmt(t.products.retireCount, { count: selected.size })}
        body={t.common.retireConfirm}
        confirmLabel={t.common.retireSelected}
        danger
        busy={busy}
        onClose={() => setConfirm(false)}
        onConfirm={() => void retireSelected()}
      />
    </div>
  );
}

export default function ProductsPage() {
  return (
    <RequirePermission permission="catalog.manage">
      <ProductsInner />
    </RequirePermission>
  );
}
