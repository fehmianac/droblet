'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RequirePermission } from '@/components/Shell';
import { emptyToNull, fieldErrors, ImageField, LinkButton, LocalizedField } from '@/components/forms';
import { Badge, Button, Card, ConfirmModal, ErrorState, Field, IconButton, Input, PageHeader, Select, Skeleton, Toggle, useAsync, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { fromLocalInput, toLocalInput } from '@/lib/dates';
import { postStatus } from '@/lib/feed';
import { useI18n } from '@/lib/i18n';
import { resolveText } from '@/lib/text';
import {
  EDIT_SEGMENTS,
  FEED_AUTHOR_KINDS,
  OCCASIONS,
  type AdminFeedPost,
  type AdminProduct,
  type EditSegment,
  type FeedAuthorKind,
  type Localized,
  type Occasion,
} from '@/lib/types';
import { newUlid } from '@/lib/ulid';

const MAX_IMAGES = 4;
const MAX_PRODUCTS = 8;

interface Paged<T> {
  items: T[];
  pageToken: string | null;
  count: number;
}

interface Form {
  id: string;
  segment: EditSegment | '';
  authorKind: FeedAuthorKind;
  authorName: Localized;
  authorHandle: string;
  authorImageUrl: string | null;
  occasion: Occasion;
  title: Localized;
  note: Localized;
  images: (string | null)[];
  productIds: string[];
  publishAt: string;
  sortOrder: string;
  published: boolean;
  retired: boolean;
}

function blank(): Form {
  return {
    id: newUlid(),
    segment: '',
    authorKind: 'edit',
    authorName: { tr: 'Droblet Edit', en: 'Droblet Edit' },
    authorHandle: '',
    authorImageUrl: null,
    occasion: 'office',
    title: {},
    note: {},
    images: [null],
    productIds: [],
    publishAt: toLocalInput(new Date().toISOString()),
    sortOrder: '0',
    published: false,
    retired: false,
  };
}

function toForm(p: AdminFeedPost): Form {
  return {
    id: p.id,
    segment: p.segment ?? '',
    authorKind: p.author.kind,
    authorName: p.author.name,
    authorHandle: p.author.handle ?? '',
    authorImageUrl: p.author.imageUrl,
    occasion: p.occasion,
    title: p.title,
    note: p.note ?? {},
    images: p.imageUrls.length ? p.imageUrls : [null],
    productIds: p.productIds,
    publishAt: toLocalInput(p.publishAt),
    sortOrder: String(p.sortOrder),
    published: p.published,
    retired: p.retired,
  };
}

/** Catalog ids of the post: chosen rows (resolved for a preview) + search by name / brand / id. */
function ProductPicker({ value, onChange, error }: { value: string[]; onChange: (ids: string[]) => void; error?: string }) {
  const { t, lang, money } = useI18n();
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState('');
  const [products, setProducts] = useState<Record<string, AdminProduct | null>>({});
  const results = useAsync(
    () =>
      query.trim().length < 2
        ? Promise.resolve([] as AdminProduct[])
        : api.get<Paged<AdminProduct>>('v1/admin/product', { query: { q: query.trim(), includeRetired: false, limit: 8 } }).then((r) => r.items),
    [query],
  );

  useEffect(() => {
    const missing = value.filter((id) => !(id in products));
    if (missing.length === 0) return;
    let alive = true;
    void Promise.all(missing.map((id) => api.get<AdminProduct>(`v1/admin/product/${encodeURIComponent(id)}`).catch(() => null))).then((found) => {
      if (!alive) return;
      setProducts((prev) => ({ ...prev, ...Object.fromEntries(missing.map((id, i) => [id, found[i] ?? null])) }));
    });
    return () => {
      alive = false;
    };
  }, [value, products]);

  const add = (id: string) => {
    const clean = id.trim();
    if (!clean || value.includes(clean) || value.length >= MAX_PRODUCTS) return;
    onChange([...value, clean]);
  };

  return (
    <Field label={t.feedPosts.products} hint={t.feedPosts.productIdsHint} error={error} htmlFor="fp-product-search">
      <div className="space-y-3">
        {value.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {value.map((id) => {
              const p = products[id];
              return (
                <li key={id} className="flex items-center gap-3 px-3 py-2">
                  <span className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-line bg-stone-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p?.images[0] && <img src={p.images[0]} alt="" className="h-full w-full object-cover" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p ? resolveText(p.name, lang) : id in products ? t.feedPosts.unknownProduct : '…'}</p>
                    <p className="font-mono text-xs text-muted">
                      {id}
                      {p && ` · ${money(p.priceMinor, p.currency)}`}
                    </p>
                  </div>
                  {p?.retired && <Badge>{t.feedPosts.retiredProduct}</Badge>}
                  {id in products && !p && <Badge tone="red">{t.feedPosts.unknownProduct}</Badge>}
                  <IconButton icon="x" label={t.common.remove} onClick={() => onChange(value.filter((v) => v !== id))} />
                </li>
              );
            })}
          </ul>
        )}
        {value.length < MAX_PRODUCTS && (
          <>
            <Input id="fp-product-search" placeholder={t.common.search} value={query} onChange={(e) => setQuery(e.target.value)} />
            {(results.data ?? []).length > 0 && (
              <ul className="max-h-64 divide-y divide-line overflow-auto rounded-lg border border-line">
                {(results.data ?? [])
                  .filter((p) => !value.includes(p.id))
                  .map((p) => (
                    <li key={p.id}>
                      <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-stone-50" onClick={() => add(p.id)}>
                        <span className="h-8 w-8 shrink-0 overflow-hidden rounded-md border border-line bg-stone-50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {p.images[0] && <img src={p.images[0]} alt="" className="h-full w-full object-cover" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">{resolveText(p.name, lang)}</span>
                        <span className="font-mono text-xs text-muted">{p.id}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Input
                aria-label={t.feedPosts.productIds}
                placeholder={t.feedPosts.productIds}
                value={manual}
                className="font-mono text-xs"
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    add(manual);
                    setManual('');
                  }
                }}
              />
              <Button
                size="sm"
                variant="subtle"
                icon="plus"
                onClick={() => {
                  add(manual);
                  setManual('');
                }}
              >
                {t.common.create}
              </Button>
            </div>
          </>
        )}
      </div>
    </Field>
  );
}

function PostForm() {
  const { t, lang, href, number, errorText, fieldError } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const id = useSearchParams().get('id');
  const isNew = !id;
  const posts = useAsync(() => (id ? api.get<AdminFeedPost[]>('v1/admin/feed-post') : Promise.resolve([] as AdminFeedPost[])), [id]);
  const [form, setForm] = useState<Form | null>(isNew ? blank() : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const existing = posts.data?.find((p) => p.id === id) ?? null;

  useEffect(() => {
    if (existing) setForm(toForm(existing));
  }, [existing]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setErrors({});
    try {
      const saved = await api.put<AdminFeedPost>(`v1/admin/feed-post/${encodeURIComponent(form.id.trim())}`, {
        segment: form.segment || null,
        author: {
          kind: form.authorKind,
          name: emptyToNull(form.authorName),
          handle: form.authorHandle.trim() || null,
          imageUrl: form.authorImageUrl,
        },
        occasion: form.occasion,
        title: emptyToNull(form.title),
        note: emptyToNull(form.note),
        imageUrls: form.images.filter((u): u is string => !!u),
        productIds: form.productIds,
        publishAt: fromLocalInput(form.publishAt),
        sortOrder: Number(form.sortOrder) || 0,
        published: form.published,
        retired: form.retired,
      });
      toast.success(t.common.saved);
      if (isNew) router.replace(href(`/feed/posts/edit/?id=${encodeURIComponent(saved.id)}`));
      else setForm(toForm(saved));
    } catch (error) {
      setErrors(fieldErrors(error, fieldError));
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const retire = async () => {
    if (!form) return;
    setBusy(true);
    try {
      await api.del(`v1/admin/feed-post/${encodeURIComponent(form.id)}`);
      toast.success(t.common.retiredDone);
      setRetiring(false);
      posts.reload();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  if (posts.error) return <Card><ErrorState error={posts.error} onRetry={posts.reload} /></Card>;
  if (!form) return <Skeleton className="h-96 w-full" />;
  if (!isNew && !existing && !posts.loading) return <Card><ErrorState error={new Error('not_found')} /></Card>;

  const status = postStatus({ retired: form.retired, published: form.published, publishAt: fromLocalInput(form.publishAt) ?? new Date().toISOString() });

  return (
    <div>
      <PageHeader
        title={isNew ? t.feedPosts.newPost : resolveText(form.title, lang) || t.feedPosts.editPost}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {status === 'retired' ? (
              <Badge>{t.common.retired}</Badge>
            ) : status === 'draft' ? (
              <Badge tone="amber">{t.feedPosts.draft}</Badge>
            ) : status === 'scheduled' ? (
              <Badge tone="blue">{t.feedPosts.scheduled}</Badge>
            ) : (
              <Badge tone="green">{t.feedPosts.live}</Badge>
            )}
            {existing && <Badge tone="neutral">{`♡ ${number(existing.likeCount)}`}</Badge>}
          </span>
        }
        actions={
          <>
            <LinkButton href={href('/feed/posts/')} variant="secondary" icon="chevronLeft">
              {t.common.back}
            </LinkButton>
            {!isNew && !form.retired && (
              <Button variant="secondary" icon="trash" onClick={() => setRetiring(true)}>
                {t.common.retire}
              </Button>
            )}
            <Button icon="check" loading={busy} onClick={() => void save()}>
              {t.common.save}
            </Button>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={t.productForm.general} className="xl:col-span-1 xl:self-start">
          <div className="space-y-4">
            <Field label={t.common.id} htmlFor="fp-id" required error={errors.id}>
              <Input id="fp-id" value={form.id} disabled className="font-mono" />
            </Field>
            <Field label={t.feedPosts.segment} htmlFor="fp-segment" error={errors.segment}>
              <Select id="fp-segment" value={form.segment} onChange={(e) => set('segment', e.target.value as EditSegment | '')}>
                <option value="">{t.feedPosts.allSegments}</option>
                {EDIT_SEGMENTS.map((s) => (
                  <option key={s} value={s}>
                    {t.enums.editSegment[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.feedPosts.occasion} htmlFor="fp-occasion" required hint={t.feedPosts.occasionHint} error={errors.occasion}>
              <Select id="fp-occasion" value={form.occasion} onChange={(e) => set('occasion', e.target.value as Occasion)}>
                {OCCASIONS.map((o) => (
                  <option key={o} value={o}>
                    {t.enums.occasion[o]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.feedPosts.publishAt} htmlFor="fp-publish" required hint={t.feedPosts.publishAtHint} error={errors.publishAt}>
              <Input id="fp-publish" type="datetime-local" value={form.publishAt} onChange={(e) => set('publishAt', e.target.value)} />
            </Field>
            <Field label={t.common.sortOrder} htmlFor="fp-order" error={errors.sortOrder}>
              <Input id="fp-order" type="number" min={0} value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
            </Field>
            <div className="space-y-3 rounded-lg bg-stone-50 p-3">
              <label className="flex items-center justify-between text-sm">
                {t.feedPosts.published}
                <Toggle checked={form.published} onChange={(v) => set('published', v)} label={t.feedPosts.published} />
              </label>
              <label className="flex items-center justify-between text-sm">
                {t.common.retired}
                <Toggle checked={form.retired} onChange={(v) => set('retired', v)} label={t.common.retired} />
              </label>
            </div>
          </div>
        </Card>
        <div className="space-y-4 xl:col-span-2">
          <Card title={t.feedPosts.author}>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <Field label={t.feedPosts.authorKind} htmlFor="fp-kind" required error={errors['author.kind'] ?? errors.author}>
                  <Select id="fp-kind" value={form.authorKind} onChange={(e) => set('authorKind', e.target.value as FeedAuthorKind)}>
                    {FEED_AUTHOR_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t.enums.feedAuthorKind[k]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <LocalizedField id="fp-aname" label={t.feedPosts.authorName} required value={form.authorName} onChange={(v) => set('authorName', v)} maxLength={60} error={errors['author.name']} />
                <Field label={t.feedPosts.authorHandle} htmlFor="fp-handle" hint={t.feedPosts.authorHandleHint} error={errors['author.handle']}>
                  <Input id="fp-handle" value={form.authorHandle} placeholder="@" onChange={(e) => set('authorHandle', e.target.value)} />
                </Field>
              </div>
              <ImageField id="fp-aimg" label={t.feedPosts.authorImage} value={form.authorImageUrl} onChange={(v) => set('authorImageUrl', v)} purpose="feed" error={errors['author.imageUrl']} />
            </div>
          </Card>
          <Card title={t.feedPosts.post}>
            <div className="space-y-4">
              <LocalizedField id="fp-title" label={t.feedPosts.titleLabel} required value={form.title} onChange={(v) => set('title', v)} maxLength={120} error={errors.title} />
              <LocalizedField id="fp-note" label={t.feedPosts.note} multiline value={form.note} onChange={(v) => set('note', v)} maxLength={600} error={errors.note} />
              <div>
                <p className="mb-1 text-[13px] font-medium">{t.feedPosts.images}</p>
                <p className="mb-2 text-xs text-muted">{t.feedPosts.imagesHint}</p>
                {errors.imageUrls && (
                  <p className="mb-2 text-xs text-red-600" role="alert">
                    {errors.imageUrls}
                  </p>
                )}
                <div className="grid gap-3 lg:grid-cols-2">
                  {form.images.map((url, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="flex-1">
                        <ImageField
                          id={`fp-img-${i}`}
                          label={`${t.common.image} ${i + 1}`}
                          value={url}
                          onChange={(v) => set('images', form.images.map((x, j) => (j === i ? v : x)))}
                          purpose="feed"
                        />
                      </div>
                      {form.images.length > 1 && (
                        <IconButton icon="trash" label={t.common.remove} onClick={() => set('images', form.images.filter((_, j) => j !== i))} />
                      )}
                    </div>
                  ))}
                </div>
                {form.images.length < MAX_IMAGES && (
                  <Button size="sm" variant="ghost" icon="plus" className="mt-2" onClick={() => set('images', [...form.images, null])}>
                    {t.feedPosts.addImage}
                  </Button>
                )}
              </div>
              <ProductPicker value={form.productIds} onChange={(ids) => set('productIds', ids)} error={errors.productIds} />
            </div>
          </Card>
        </div>
      </div>
      <ConfirmModal
        open={retiring}
        title={`${t.common.retire}: ${resolveText(form.title, lang)}`}
        body={t.common.retireConfirm}
        confirmLabel={t.common.retire}
        danger
        busy={busy}
        onClose={() => setRetiring(false)}
        onConfirm={() => void retire()}
      />
    </div>
  );
}

export default function FeedPostEditorPage() {
  return (
    <RequirePermission permission="content.manage">
      <PostForm />
    </RequirePermission>
  );
}
