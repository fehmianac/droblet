'use client';

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
  Select,
  TableSkeleton,
  Toggle,
  useAsync,
  useToast,
  type Column,
} from '@/components/ui';
import { api } from '@/lib/api';
import { fromLocalInput, toLocalInput } from '@/lib/dates';
import { storyStatus } from '@/lib/feed';
import { useI18n } from '@/lib/i18n';
import { resolveText } from '@/lib/text';
import { EDIT_SEGMENTS, type AdminFeedStory, type EditSegment, type Localized } from '@/lib/types';
import { newUlid } from '@/lib/ulid';

interface Form {
  id: string;
  segment: EditSegment | '';
  authorName: Localized;
  authorImageUrl: string | null;
  imageUrl: string | null;
  headline: Localized;
  productId: string;
  publishAt: string;
  expiresAt: string;
  sortOrder: string;
  published: boolean;
  retired: boolean;
}

function StoriesInner() {
  const { t, lang, dateTime, errorText, fieldError } = useI18n();
  const toast = useToast();
  const list = useAsync(() => api.get<AdminFeedStory[]>('v1/admin/feed-story'), []);
  const [form, setForm] = useState<Form | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [retiring, setRetiring] = useState<AdminFeedStory | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const open = (s: AdminFeedStory | null) => {
    setErrors({});
    setIsNew(!s);
    setForm(
      s
        ? {
            id: s.id,
            segment: s.segment ?? '',
            authorName: s.author.name,
            authorImageUrl: s.author.imageUrl,
            imageUrl: s.imageUrl,
            headline: s.headline,
            productId: s.productId ?? '',
            publishAt: toLocalInput(s.publishAt),
            expiresAt: toLocalInput(s.expiresAt),
            sortOrder: String(s.sortOrder),
            published: s.published,
            retired: s.retired,
          }
        : {
            id: newUlid(),
            segment: '',
            authorName: { tr: 'Droblet Edit', en: 'Droblet Edit' },
            authorImageUrl: null,
            imageUrl: null,
            headline: {},
            productId: '',
            publishAt: toLocalInput(new Date().toISOString()),
            expiresAt: '',
            sortOrder: '0',
            published: false,
            retired: false,
          },
    );
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setErrors({});
    try {
      await api.put(`v1/admin/feed-story/${encodeURIComponent(form.id)}`, {
        segment: form.segment || null,
        author: { name: emptyToNull(form.authorName), imageUrl: form.authorImageUrl },
        imageUrl: form.imageUrl,
        headline: emptyToNull(form.headline),
        productId: form.productId.trim() || null,
        publishAt: fromLocalInput(form.publishAt),
        expiresAt: fromLocalInput(form.expiresAt),
        sortOrder: Number(form.sortOrder) || 0,
        published: form.published,
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
      await api.del(`v1/admin/feed-story/${encodeURIComponent(retiring.id)}`);
      toast.success(t.common.retiredDone);
      setRetiring(null);
      list.reload();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<AdminFeedStory>[] = [
    {
      key: 'headline',
      header: t.feedStories.headline,
      sortValue: (s) => resolveText(s.headline, lang),
      render: (s) => (
        <div className="flex items-center gap-3">
          <span className="h-14 w-10 shrink-0 overflow-hidden rounded-lg border border-line bg-stone-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {s.imageUrl && <img src={s.imageUrl} alt="" className="h-full w-full object-cover" />}
          </span>
          <div>
            <p className="font-medium">{resolveText(s.headline, lang)}</p>
            <p className="text-xs text-muted">{resolveText(s.author.name, lang)}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'segment',
      header: t.feedPosts.segment,
      render: (s) => (s.segment ? t.enums.editSegment[s.segment] : <span className="text-muted">{t.feedPosts.allSegments}</span>),
    },
    {
      key: 'status',
      header: t.common.status,
      sortValue: (s) => storyStatus(s),
      render: (s) => {
        const status = storyStatus(s);
        return status === 'retired' ? (
          <Badge>{t.common.retired}</Badge>
        ) : status === 'draft' ? (
          <Badge tone="amber">{t.feedPosts.draft}</Badge>
        ) : status === 'scheduled' ? (
          <Badge tone="blue">{t.feedPosts.scheduled}</Badge>
        ) : status === 'expired' ? (
          <Badge>{t.feedStories.expired}</Badge>
        ) : (
          <Badge tone="green">{t.feedStories.active}</Badge>
        );
      },
    },
    { key: 'publishAt', header: t.feedStories.publishAt, sortValue: (s) => s.publishAt, render: (s) => <span className="whitespace-nowrap text-muted">{dateTime(s.publishAt)}</span> },
    {
      key: 'expiresAt',
      header: t.feedStories.expiresAt,
      sortValue: (s) => s.expiresAt ?? '',
      render: (s) => <span className="whitespace-nowrap text-muted">{s.expiresAt ? dateTime(s.expiresAt) : '—'}</span>,
    },
    { key: 'order', header: t.common.sortOrder, sortValue: (s) => s.sortOrder, render: (s) => s.sortOrder },
    {
      key: 'actions',
      header: <span className="sr-only">{t.common.actions}</span>,
      className: 'text-right',
      render: (s) => (
        <div className="flex justify-end gap-1">
          <IconButton icon="pencil" label={t.common.edit} onClick={() => open(s)} />
          {!s.retired && <IconButton icon="trash" label={t.common.retire} onClick={() => setRetiring(s)} />}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t.feedStories.title}
        subtitle={t.feedStories.subtitle}
        actions={
          <Button icon="plus" onClick={() => open(null)}>
            {t.feedStories.newStory}
          </Button>
        }
      />
      <Card padded={false}>
        {list.loading ? <TableSkeleton /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : <DataTable columns={columns} rows={list.data ?? []} rowKey={(s) => s.id} />}
      </Card>
      <Drawer
        open={!!form}
        title={isNew ? t.feedStories.newStory : t.feedStories.editStory}
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
            <Field label={t.common.id} htmlFor="fs-id" error={errors.id}>
              <Input id="fs-id" value={form.id} disabled className="font-mono" />
            </Field>
            <Field label={t.feedPosts.segment} htmlFor="fs-segment" error={errors.segment}>
              <Select id="fs-segment" value={form.segment} onChange={(e) => set('segment', e.target.value as EditSegment | '')}>
                <option value="">{t.feedPosts.allSegments}</option>
                {EDIT_SEGMENTS.map((s) => (
                  <option key={s} value={s}>
                    {t.enums.editSegment[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <LocalizedField id="fs-aname" label={t.feedPosts.authorName} required value={form.authorName} onChange={(v) => set('authorName', v)} maxLength={60} error={errors['author.name'] ?? errors.author} />
            <ImageField id="fs-aimg" label={t.feedPosts.authorImage} value={form.authorImageUrl} onChange={(v) => set('authorImageUrl', v)} purpose="feed" error={errors['author.imageUrl']} />
            <ImageField id="fs-img" label={t.feedStories.image} value={form.imageUrl} onChange={(v) => set('imageUrl', v)} purpose="feed" error={errors.imageUrl} />
            <LocalizedField id="fs-headline" label={t.feedStories.headline} required value={form.headline} onChange={(v) => set('headline', v)} maxLength={120} error={errors.headline} />
            <Field label={t.feedStories.productId} htmlFor="fs-product" hint={t.feedStories.productIdHint} error={errors.productId ?? errors.productIds}>
              <Input id="fs-product" value={form.productId} className="font-mono" onChange={(e) => set('productId', e.target.value)} />
            </Field>
            <Field label={t.feedStories.publishAt} htmlFor="fs-publish" required error={errors.publishAt}>
              <Input id="fs-publish" type="datetime-local" value={form.publishAt} onChange={(e) => set('publishAt', e.target.value)} />
            </Field>
            <Field label={t.feedStories.expiresAt} htmlFor="fs-expires" hint={t.feedStories.expiresAtHint} error={errors.expiresAt}>
              <Input id="fs-expires" type="datetime-local" value={form.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
            </Field>
            <Field label={t.common.sortOrder} htmlFor="fs-order" error={errors.sortOrder}>
              <Input id="fs-order" type="number" min={0} value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
            </Field>
            <label className="flex items-center gap-3 text-sm">
              <Toggle checked={form.published} onChange={(v) => set('published', v)} label={t.feedPosts.published} />
              {t.feedPosts.published}
            </label>
            <label className="flex items-center gap-3 text-sm">
              <Toggle checked={form.retired} onChange={(v) => set('retired', v)} label={t.common.retired} />
              {t.common.retired}
            </label>
          </div>
        )}
      </Drawer>
      <ConfirmModal
        open={!!retiring}
        title={`${t.common.retire}: ${retiring ? resolveText(retiring.headline, lang) : ''}`}
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

export default function FeedStoriesPage() {
  return (
    <RequirePermission permission="content.manage">
      <StoriesInner />
    </RequirePermission>
  );
}
