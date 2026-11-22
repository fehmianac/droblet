'use client';

import { useRouter } from 'next/navigation';
import { RequirePermission } from '@/components/Shell';
import { LinkButton } from '@/components/forms';
import { Badge, Card, DataTable, ErrorState, PageHeader, TableSkeleton, useAsync, type Column } from '@/components/ui';
import { api } from '@/lib/api';
import { postStatus } from '@/lib/feed';
import { useI18n } from '@/lib/i18n';
import { resolveText } from '@/lib/text';
import type { AdminFeedPost } from '@/lib/types';

function PostsInner() {
  const { t, lang, href, dateTime, number } = useI18n();
  const router = useRouter();
  const list = useAsync(() => api.get<AdminFeedPost[]>('v1/admin/feed-post'), []);

  const columns: Column<AdminFeedPost>[] = [
    {
      key: 'post',
      header: t.feedPosts.post,
      sortValue: (p) => resolveText(p.title, lang),
      render: (p) => (
        <div className="flex items-center gap-3">
          <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-line bg-stone-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.imageUrls[0] && <img src={p.imageUrls[0]} alt="" className="h-full w-full object-cover" />}
          </span>
          <div>
            <p className="font-medium text-ink">{resolveText(p.title, lang)}</p>
            <p className="font-mono text-xs text-muted">{p.id}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'author',
      header: t.feedPosts.author,
      sortValue: (p) => resolveText(p.author.name, lang),
      render: (p) => (
        <div>
          <p>{resolveText(p.author.name, lang)}</p>
          <p className="text-xs text-muted">{t.enums.feedAuthorKind[p.author.kind]}</p>
        </div>
      ),
    },
    { key: 'occasion', header: t.feedPosts.occasion, sortValue: (p) => p.occasion, render: (p) => t.enums.occasion[p.occasion] ?? p.occasion },
    {
      key: 'segment',
      header: t.feedPosts.segment,
      render: (p) => (p.segment ? t.enums.editSegment[p.segment] : <span className="text-muted">{t.feedPosts.allSegments}</span>),
    },
    {
      key: 'status',
      header: t.common.status,
      sortValue: (p) => postStatus(p),
      render: (p) => {
        const status = postStatus(p);
        return status === 'retired' ? (
          <Badge>{t.common.retired}</Badge>
        ) : status === 'draft' ? (
          <Badge tone="amber">{t.feedPosts.draft}</Badge>
        ) : status === 'scheduled' ? (
          <Badge tone="blue">{t.feedPosts.scheduled}</Badge>
        ) : (
          <Badge tone="green">{t.feedPosts.live}</Badge>
        );
      },
    },
    {
      key: 'publishAt',
      header: t.feedPosts.publishAt,
      sortValue: (p) => p.publishAt,
      render: (p) => <span className="whitespace-nowrap text-muted">{dateTime(p.publishAt)}</span>,
    },
    { key: 'products', header: t.feedPosts.products, sortValue: (p) => p.productIds.length, render: (p) => number(p.productIds.length) },
    { key: 'likes', header: t.feedPosts.likes, sortValue: (p) => p.likeCount, render: (p) => <span className="font-medium">{number(p.likeCount)}</span> },
  ];

  return (
    <div>
      <PageHeader
        title={t.feedPosts.title}
        subtitle={t.feedPosts.subtitle}
        actions={
          <LinkButton href={href('/feed/posts/edit/')} icon="plus">
            {t.feedPosts.newPost}
          </LinkButton>
        }
      />
      <Card padded={false}>
        {list.loading ? (
          <TableSkeleton />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : (
          <DataTable columns={columns} rows={list.data ?? []} rowKey={(p) => p.id} onRowClick={(p) => router.push(href(`/feed/posts/edit/?id=${encodeURIComponent(p.id)}`))} />
        )}
      </Card>
    </div>
  );
}

export default function FeedPostsPage() {
  return (
    <RequirePermission permission="content.manage">
      <PostsInner />
    </RequirePermission>
  );
}
