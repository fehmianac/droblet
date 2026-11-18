'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RequirePermission } from '@/components/Shell';
import { emptyToNull, fieldErrors, ImageField, LinkButton, LocalizedField, splitList } from '@/components/forms';
import { Badge, Button, Card, ErrorState, Field, IconButton, Input, PageHeader, Select, Skeleton, Toggle, useAsync, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { mondayOf } from '@/lib/dates';
import { useI18n } from '@/lib/i18n';
import { resolveText } from '@/lib/text';
import { PRICE_BANDS, type AdminBrand, type AdminEdit, type Localized, type PriceBand } from '@/lib/types';

interface VariantForm {
  priceBand: PriceBand;
  productIds: string;
}
interface LookForm {
  id: string | null;
  day: number;
  title: Localized;
  styleNote: Localized;
  imageUrl: string | null;
  variants: VariantForm[];
}
interface Form {
  id: string;
  weekStart: string;
  title: Localized;
  subtitle: Localized;
  coverImageUrl: string | null;
  sponsorBrandId: string;
  sponsorName: Localized;
  published: boolean;
  retired: boolean;
  looks: LookForm[];
}

function blank(): Form {
  const week = mondayOf(new Date(Date.now() + 7 * 86_400_000));
  return {
    id: `edit-${week}`,
    weekStart: week,
    title: {},
    subtitle: {},
    coverImageUrl: null,
    sponsorBrandId: '',
    sponsorName: {},
    published: false,
    retired: false,
    looks: [],
  };
}

function toForm(e: AdminEdit): Form {
  return {
    id: e.id,
    weekStart: e.weekStart,
    title: e.title,
    subtitle: e.subtitle ?? {},
    coverImageUrl: e.coverImageUrl,
    sponsorBrandId: e.sponsorBrandId ?? '',
    sponsorName: e.sponsorName ?? {},
    published: e.published,
    retired: e.retired,
    looks: e.looks.map((l) => ({
      id: l.id,
      day: l.day,
      title: l.title,
      styleNote: l.styleNote ?? {},
      imageUrl: l.imageUrl,
      variants: l.variants.map((v) => ({ priceBand: v.priceBand, productIds: v.productIds.join(', ') })),
    })),
  };
}

function EditForm() {
  const { t, lang, fmt, href, errorText, fieldError } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const id = useSearchParams().get('id');
  const isNew = !id;
  const edits = useAsync(() => (id ? api.get<AdminEdit[]>('v1/admin/edit') : Promise.resolve([] as AdminEdit[])), [id]);
  const brands = useAsync(() => api.get<AdminBrand[]>('v1/admin/brand').catch(() => [] as AdminBrand[]), []);
  const [form, setForm] = useState<Form | null>(isNew ? blank() : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const existing = edits.data?.find((e) => e.id === id) ?? null;

  useEffect(() => {
    if (existing) setForm(toForm(existing));
  }, [existing]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const setLook = (day: number, patch: Partial<LookForm>) =>
    setForm((f) => (f ? { ...f, looks: f.looks.map((l) => (l.day === day ? { ...l, ...patch } : l)) } : f));

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setErrors({});
    try {
      const saved = await api.put<AdminEdit>(`v1/admin/edit/${encodeURIComponent(form.id.trim())}`, {
        segment: 'women',
        weekStart: form.weekStart,
        title: emptyToNull(form.title),
        subtitle: emptyToNull(form.subtitle),
        coverImageUrl: form.coverImageUrl,
        looks: [...form.looks]
          .sort((a, b) => a.day - b.day)
          .map((l) => ({
            id: l.id,
            day: l.day,
            title: emptyToNull(l.title),
            styleNote: emptyToNull(l.styleNote),
            imageUrl: l.imageUrl,
            variants: l.variants.map((v) => ({ priceBand: v.priceBand, productIds: splitList(v.productIds) })),
          })),
        sponsorBrandId: form.sponsorBrandId || null,
        sponsorName: emptyToNull(form.sponsorName),
        published: form.published,
        retired: form.retired,
      });
      toast.success(t.common.saved);
      if (isNew) router.replace(href(`/content/edits/edit/?id=${encodeURIComponent(saved.id)}`));
      else setForm(toForm(saved));
    } catch (error) {
      setErrors(fieldErrors(error, fieldError));
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  if (edits.error) return <Card><ErrorState error={edits.error} onRetry={edits.reload} /></Card>;
  if (!form) return <Skeleton className="h-96 w-full" />;
  if (!isNew && !existing && !edits.loading) return <Card><ErrorState error={new Error('not_found')} /></Card>;

  const lookErrors = Object.entries(errors).filter(([k]) => k.startsWith('looks'));

  return (
    <div>
      <PageHeader
        title={isNew ? t.edits.newEdit : resolveText(form.title, lang) || t.edits.editTitle}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {form.published ? <Badge tone="green">{t.edits.published}</Badge> : <Badge tone="amber">{t.edits.draft}</Badge>}
            <Badge tone={form.looks.length === 7 ? 'green' : 'neutral'}>{fmt(t.edits.looksCount, { count: form.looks.length })}</Badge>
            {form.sponsorBrandId && <Badge tone="blue">{t.edits.sponsored}</Badge>}
          </span>
        }
        actions={
          <>
            <LinkButton href={href('/content/edits/')} variant="secondary" icon="chevronLeft">
              {t.common.back}
            </LinkButton>
            <Button icon="check" loading={busy} onClick={() => void save()}>
              {t.common.save}
            </Button>
          </>
        }
      />
      {lookErrors.length > 0 && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {lookErrors.map(([k, v]) => (
            <p key={k}>
              <span className="font-mono text-xs">{k}</span>: {v}
            </p>
          ))}
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={t.productForm.general} className="xl:col-span-1 xl:self-start">
          <div className="space-y-4">
            <Field label={t.common.id} htmlFor="e-id" required error={errors.id}>
              <Input id="e-id" value={form.id} disabled={!isNew} onChange={(e) => set('id', e.target.value.toLowerCase())} className="font-mono" />
            </Field>
            <Field label={t.edits.weekStart} htmlFor="e-week" required error={errors.weekStart}>
              <Input id="e-week" type="date" value={form.weekStart} onChange={(e) => set('weekStart', e.target.value)} />
            </Field>
            <LocalizedField id="e-title" label={t.edits.titleLabel} required value={form.title} onChange={(v) => set('title', v)} maxLength={120} error={errors.title} />
            <LocalizedField id="e-sub" label={t.edits.subtitleLabel} value={form.subtitle} onChange={(v) => set('subtitle', v)} maxLength={240} error={errors.subtitle} />
            <ImageField id="e-cover" label={t.edits.coverImage} value={form.coverImageUrl} onChange={(v) => set('coverImageUrl', v)} purpose="edit" error={errors.coverImageUrl} />
            <Field label={t.edits.sponsorBrand} htmlFor="e-sponsor" error={errors.sponsorBrandId}>
              <Select id="e-sponsor" value={form.sponsorBrandId} onChange={(e) => set('sponsorBrandId', e.target.value)}>
                <option value="">{t.edits.noSponsor}</option>
                {(brands.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            {form.sponsorBrandId && (
              <LocalizedField id="e-sname" label={t.edits.sponsorName} value={form.sponsorName} onChange={(v) => set('sponsorName', v)} maxLength={80} error={errors.sponsorName} />
            )}
            <div className="space-y-3 rounded-lg bg-stone-50 p-3">
              <label className="flex items-center justify-between text-sm">
                {t.edits.published}
                <Toggle checked={form.published} onChange={(v) => set('published', v)} label={t.edits.published} />
              </label>
              <p className="text-xs text-muted">{t.edits.publishHint}</p>
              <label className="flex items-center justify-between text-sm">
                {t.common.retired}
                <Toggle checked={form.retired} onChange={(v) => set('retired', v)} label={t.common.retired} />
              </label>
            </div>
          </div>
        </Card>
        <div className="space-y-3 xl:col-span-2">
          {[1, 2, 3, 4, 5, 6, 7].map((day) => {
            const look = form.looks.find((l) => l.day === day);
            const dayName = t.edits.days[day - 1] ?? fmt(t.edits.day, { day });
            return (
              <Card
                key={day}
                title={
                  <span className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-50 text-xs font-semibold text-brand-700">{day}</span>
                    {dayName}
                  </span>
                }
                actions={
                  look ? (
                    <IconButton icon="trash" label={t.edits.removeLook} onClick={() => set('looks', form.looks.filter((l) => l.day !== day))} />
                  ) : (
                    <Button
                      size="sm"
                      variant="subtle"
                      icon="plus"
                      onClick={() =>
                        set('looks', [...form.looks, { id: null, day, title: {}, styleNote: {}, imageUrl: null, variants: [{ priceBand: 'highStreet', productIds: '' }] }])
                      }
                    >
                      {t.edits.addLook}
                    </Button>
                  )
                }
                padded={!!look}
              >
                {look ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-4">
                      <LocalizedField id={`l${day}-title`} label={t.edits.lookTitle} required value={look.title} onChange={(v) => setLook(day, { title: v })} maxLength={120} />
                      <LocalizedField id={`l${day}-note`} label={t.edits.styleNote} multiline value={look.styleNote} onChange={(v) => setLook(day, { styleNote: v })} maxLength={600} />
                    </div>
                    <div className="space-y-4">
                      <ImageField id={`l${day}-img`} label={t.common.image} value={look.imageUrl} onChange={(v) => setLook(day, { imageUrl: v })} purpose="edit" />
                      <div>
                        <p className="mb-2 text-[13px] font-medium">{t.edits.variants}</p>
                        <div className="space-y-2">
                          {look.variants.map((v, i) => (
                            <div key={i} className="flex gap-2">
                              <Select
                                aria-label={t.products.priceBand}
                                value={v.priceBand}
                                className="w-40 shrink-0"
                                onChange={(e) =>
                                  setLook(day, { variants: look.variants.map((x, j) => (j === i ? { ...x, priceBand: e.target.value as PriceBand } : x)) })
                                }
                              >
                                {PRICE_BANDS.map((b) => (
                                  <option key={b} value={b}>
                                    {t.enums.priceBand[b]}
                                  </option>
                                ))}
                              </Select>
                              <Input
                                aria-label={t.edits.productIds}
                                placeholder={t.edits.productIdsHint}
                                value={v.productIds}
                                className="font-mono text-xs"
                                onChange={(e) => setLook(day, { variants: look.variants.map((x, j) => (j === i ? { ...x, productIds: e.target.value } : x)) })}
                              />
                              {look.variants.length > 1 && (
                                <IconButton icon="x" label={t.common.remove} onClick={() => setLook(day, { variants: look.variants.filter((_, j) => j !== i) })} />
                              )}
                            </div>
                          ))}
                        </div>
                        {look.variants.length < 2 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon="plus"
                            className="mt-2"
                            onClick={() =>
                              setLook(day, {
                                variants: [...look.variants, { priceBand: look.variants[0]?.priceBand === 'highStreet' ? 'luxuryTouch' : 'highStreet', productIds: '' }],
                              })
                            }
                          >
                            {t.edits.addVariant}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function EditEditorPage() {
  return (
    <RequirePermission permission="content.manage">
      <EditForm />
    </RequirePermission>
  );
}
