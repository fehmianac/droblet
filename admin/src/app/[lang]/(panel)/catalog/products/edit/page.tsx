'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RequirePermission } from '@/components/Shell';
import { emptyToNull, fieldErrors, formatMoneyInput, LinkButton, LocalizedField, parseMoney, splitList, UploadButton } from '@/components/forms';
import { Icon } from '@/components/icons';
import { Badge, Button, Card, ErrorState, Field, IconButton, Input, PageHeader, Select, Skeleton, Toggle, useAsync, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { resolveText } from '@/lib/text';
import {
  CATALOG_SEGMENTS,
  PRICE_BANDS,
  PRODUCT_CATEGORIES,
  type AdminBrand,
  type AdminProduct,
  type AffiliateSource,
  type CatalogSegment,
  type Localized,
  type PriceBand,
  type ProductCategory,
  type ProductWriteResult,
} from '@/lib/types';

interface Form {
  id: string;
  brandId: string;
  name: Localized;
  description: Localized;
  category: ProductCategory;
  colors: string;
  sizes: string;
  price: string;
  priceBand: PriceBand;
  images: string[];
  affiliateUrl: string;
  affiliateSource: AffiliateSource | '';
  retired: boolean;
  segment: CatalogSegment;
}

const blank: Form = {
  id: '',
  brandId: '',
  name: {},
  description: {},
  category: 'shirt',
  colors: '',
  sizes: '',
  price: '',
  priceBand: 'highStreet',
  images: [],
  affiliateUrl: '',
  affiliateSource: '',
  retired: false,
  segment: 'women',
};

function toForm(p: AdminProduct): Form {
  return {
    id: p.id,
    brandId: p.brandId,
    name: p.name,
    description: p.description ?? {},
    category: p.category,
    colors: p.colors.join(', '),
    sizes: p.sizes.join(', '),
    price: formatMoneyInput(p.priceMinor),
    priceBand: p.priceBand,
    images: p.images,
    affiliateUrl: p.affiliateUrl ?? '',
    affiliateSource: p.affiliateSource,
    retired: p.retired,
    segment: p.segment ?? 'women',
  };
}

function ProductForm() {
  const { t, lang, fmt, href, dateTime, money, errorText, fieldError } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const id = useSearchParams().get('id');
  const isNew = !id;
  const brands = useAsync(() => api.get<AdminBrand[]>('v1/admin/brand'), []);
  const product = useAsync(() => (id ? api.get<AdminProduct>(`v1/admin/product/${encodeURIComponent(id)}`) : Promise.resolve(null)), [id]);
  const [form, setForm] = useState<Form | null>(isNew ? { ...blank } : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [newUrl, setNewUrl] = useState('');

  useEffect(() => {
    if (product.data) setForm(toForm(product.data));
    else if (isNew) setForm({ ...blank });
  }, [product.data, isNew]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const save = async () => {
    if (!form) return;
    const priceMinor = parseMoney(form.price);
    setBusy(true);
    setErrors({});
    try {
      const result = await api.put<ProductWriteResult>(`v1/admin/product/${encodeURIComponent(form.id.trim())}`, {
        brandId: form.brandId,
        name: emptyToNull(form.name),
        description: emptyToNull(form.description),
        category: form.category,
        colors: splitList(form.colors).map((c) => c.toLowerCase()),
        sizes: splitList(form.sizes),
        priceMinor: priceMinor ?? 0,
        currency: 'TRY',
        priceBand: form.priceBand,
        images: form.images,
        affiliateUrl: form.affiliateUrl.trim() || null,
        affiliateSource: form.affiliateSource || null,
        retired: form.retired,
        segment: form.segment,
      });
      if (result.priceDropped) toast.info(fmt(t.productForm.priceDropped, { count: result.watchersFlagged }));
      toast.success(result.created ? t.productForm.created : t.common.saved);
      if (isNew) router.replace(href(`/catalog/products/edit/?id=${encodeURIComponent(result.product.id)}`));
      else product.setData(result.product);
    } catch (error) {
      setErrors(fieldErrors(error, fieldError));
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  if (product.error) {
    return (
      <Card>
        <ErrorState error={product.error} onRetry={product.reload} />
      </Card>
    );
  }
  if (!form) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-4 xl:grid-cols-3">
          <Skeleton className="h-96 xl:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  const brand = brands.data?.find((b) => b.id === form.brandId);
  const moveToFront = (i: number) => set('images', [form.images[i]!, ...form.images.filter((_, j) => j !== i)]);

  return (
    <div>
      <PageHeader
        title={isNew ? t.productForm.newTitle : resolveText(form.name, lang) || t.productForm.editTitle}
        subtitle={
          !isNew && product.data ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{product.data.id}</span>
              {product.data.retired ? <Badge>{t.common.retired}</Badge> : <Badge tone="green">{t.common.active}</Badge>}
              <span>
                {t.common.updatedAt}: {dateTime(product.data.updatedAt)}
              </span>
            </span>
          ) : undefined
        }
        actions={
          <>
            <LinkButton href={href('/catalog/products/')} variant="secondary" icon="chevronLeft">
              {t.common.back}
            </LinkButton>
            <Button icon="check" loading={busy} onClick={() => void save()}>
              {t.common.save}
            </Button>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title={t.productForm.general}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.common.id} htmlFor="p-id" required error={errors.id} hint={isNew ? t.brands.idHint : undefined}>
                <Input id="p-id" value={form.id} disabled={!isNew} onChange={(e) => set('id', e.target.value.toLowerCase())} className="font-mono" />
              </Field>
              <Field label={t.products.brand} htmlFor="p-brand" required error={errors.brandId}>
                <Select id="p-brand" value={form.brandId} onChange={(e) => set('brandId', e.target.value)}>
                  <option value="">—</option>
                  {(brands.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.retired ? ` (${t.common.retired})` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.products.category} htmlFor="p-cat" required error={errors.category}>
                <Select id="p-cat" value={form.category} onChange={(e) => set('category', e.target.value as ProductCategory)}>
                  {PRODUCT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t.enums.productCategory[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.products.segment} htmlFor="p-segment" required error={errors.segment}>
                <Select id="p-segment" value={form.segment} onChange={(e) => set('segment', e.target.value as CatalogSegment)}>
                  {CATALOG_SEGMENTS.map((s) => (
                    <option key={s} value={s}>
                      {t.enums.catalogSegment[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.products.priceBand} htmlFor="p-band" required error={errors.priceBand}>
                <Select id="p-band" value={form.priceBand} onChange={(e) => set('priceBand', e.target.value as PriceBand)}>
                  {PRICE_BANDS.map((b) => (
                    <option key={b} value={b}>
                      {t.enums.priceBand[b]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.productForm.colors} htmlFor="p-colors" hint={t.productForm.colorsHint} error={errors.colors}>
                <Input id="p-colors" value={form.colors} onChange={(e) => set('colors', e.target.value)} />
              </Field>
              <Field label={t.productForm.sizes} htmlFor="p-sizes" hint={t.productForm.sizesHint} error={errors.sizes}>
                <Input id="p-sizes" value={form.sizes} onChange={(e) => set('sizes', e.target.value)} />
              </Field>
            </div>
          </Card>
          <Card title={t.productForm.texts}>
            <div className="space-y-4">
              <LocalizedField id="p-name" label={t.productForm.nameLabel} required value={form.name} onChange={(v) => set('name', v)} maxLength={160} error={errors.name} />
              <LocalizedField
                id="p-desc"
                label={t.productForm.descriptionLabel}
                multiline
                value={form.description}
                onChange={(v) => set('description', v)}
                maxLength={2000}
                error={errors.description}
              />
            </div>
          </Card>
          <Card title={t.productForm.pricing}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.productForm.priceLabel} htmlFor="p-price" required hint={t.productForm.priceHint} error={errors.priceMinor}>
                <Input id="p-price" inputMode="decimal" value={form.price} onChange={(e) => set('price', e.target.value)} placeholder="1299.90" />
              </Field>
              <Field label={t.productForm.previousPrice} htmlFor="p-prev">
                <Input id="p-prev" disabled value={product.data?.previousPriceMinor ? money(product.data.previousPriceMinor) : '—'} />
              </Field>
              <Field label={t.productForm.affiliateUrl} htmlFor="p-aff" error={errors.affiliateUrl} className="sm:col-span-2">
                <Input id="p-aff" type="url" placeholder="https://" value={form.affiliateUrl} onChange={(e) => set('affiliateUrl', e.target.value)} />
              </Field>
              <Field label={t.productForm.affiliateSource} htmlFor="p-src" error={errors.affiliateSource}>
                <Select id="p-src" value={form.affiliateSource} onChange={(e) => set('affiliateSource', e.target.value as AffiliateSource | '')}>
                  <option value="">
                    {t.productForm.sourceFromBrand}
                    {brand ? ` (${t.enums.source[brand.source]})` : ''}
                  </option>
                  <option value="network">{t.enums.source.network}</option>
                  <option value="direct">{t.enums.source.direct}</option>
                </Select>
              </Field>
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title={t.productForm.media} actions={<UploadButton purpose="product" size="sm" onUploaded={(url) => set('images', [...form.images, url])} />}>
            {errors.images && <p className="mb-3 text-xs text-red-600">{errors.images}</p>}
            {form.images.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{t.productForm.noImages}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3">
                {form.images.map((url, i) => (
                  <li key={`${url}-${i}`} className="group relative overflow-hidden rounded-lg border border-line bg-stone-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="aspect-[3/4] w-full object-cover" />
                    {i === 0 && (
                      <span className="absolute top-2 left-2">
                        <Badge tone="brand">{t.common.image} 1</Badge>
                      </span>
                    )}
                    <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/50 p-1.5">
                      {i > 0 && (
                        <button type="button" onClick={() => moveToFront(i)} className="rounded bg-white/90 px-2 py-1 text-xs font-medium text-ink hover:bg-white">
                          {t.productForm.makeCover}
                        </button>
                      )}
                      <IconButton
                        icon="trash"
                        label={t.common.remove}
                        className="h-7 w-7 bg-white/90 text-red-700 hover:bg-white"
                        onClick={() => set('images', form.images.filter((_, j) => j !== i))}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex gap-2">
              <Input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder={t.productForm.imageUrlPlaceholder} aria-label={t.productForm.addImageUrl} />
              <Button
                variant="secondary"
                icon="plus"
                disabled={!newUrl.trim().startsWith('https://')}
                onClick={() => {
                  set('images', [...form.images, newUrl.trim()]);
                  setNewUrl('');
                }}
              >
                {t.common.add}
              </Button>
            </div>
          </Card>
          <Card title={t.common.status}>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <Icon name="ban" className="h-4 w-4 text-muted" />
                {t.common.retired}
              </span>
              <Toggle checked={form.retired} onChange={(v) => set('retired', v)} label={t.common.retired} />
            </label>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function ProductEditPage() {
  return (
    <RequirePermission permission="catalog.manage">
      <ProductForm />
    </RequirePermission>
  );
}
