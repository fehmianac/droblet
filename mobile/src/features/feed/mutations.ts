import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { track } from '@/analytics/track';
import { apiRequest } from '@/api/client';
import type {
  FeedLookMode,
  FeedPost,
  HideFeedPostRequest,
  LikeFeedPostRequest,
  ReportFeedPostRequest,
  SaveFeedPostAsLookRequest,
  SaveFeedPostRequest,
} from '@/api/contracts/feed';
import type { Look } from '@/api/contracts/looks';
import type { ReportReason } from '@/api/contracts/social';
import { fromSource } from '@/api/dataSource';
import { ApiError } from '@/api/errors';
import type { FeedLikeWire } from '@/api/wire/feed';
import { fromReportReason } from '@/api/wire/social';
import { toLookAsync, type LookWire } from '@/api/wire/wardrobe';
import { toast } from '@/components/ui/toast';
import { lookKeys } from '@/features/looks/queries';
import { openPaywall } from '@/features/teen/TeenLocks';
import { wardrobeKeys } from '@/features/wardrobe/queries';
import { feedFixtures } from '@/fixtures/feed';
import i18n from '@/i18n';
import { ulid } from '@/lib/ids';
import { newClientMutation } from '@/sync/clientMutation';
import { useIsOnline } from '@/sync/network';
import { TENANT_WRITE_SCOPE } from '@/sync/queryKeys';

import { applyLike, hidePostThisSession, ownedItemIds, removeFeedPost, updateFeedPosts } from './logic';
import { feedKeys, type FeedPages } from './queries';

export const feedMutationKeys = {
  like: ['tenant', 'feed-post', 'like'] as const,
  save: ['tenant', 'feed-post', 'save'] as const,
  hide: ['tenant', 'feed-post', 'hide'] as const,
  report: ['tenant', 'feed-post', 'report'] as const,
  saveAsLook: ['tenant', 'feed-post', 'look'] as const,
};

/** Which sentence a failed "Looklarıma ekle" shows; `paywall` = the plan's limit (the paywall opens instead of a toast). */
export function saveAsLookErrorKey(error: unknown): 'paywall' | 'notSavable' | 'gone' | 'failed' {
  if (!(error instanceof ApiError)) return 'failed';
  if (error.code === 'premium_required' || error.status === 402) return 'paywall';
  if (error.code === 'look_not_savable') return 'notSavable';
  if (error.status === 404) return 'gone';
  return 'failed';
}

const postPath = (id: string) => `v1/tenant/feed-post/${encodeURIComponent(id)}`;

/** Writes `change` into every cached copy of the post: each tab's pages, the saved list and the copy of the open detail. */
function patchPost(client: QueryClient, postId: string, change: (post: FeedPost) => FeedPost): void {
  client.setQueriesData<FeedPages>({ queryKey: feedKeys.posts }, (prev) => updateFeedPosts(prev, (p) => p.id === postId, change));
  client.setQueryData<FeedPost[]>(feedKeys.saved, (prev) => prev?.map((p) => (p.id === postId ? change(p) : p)));
  client.setQueryData<FeedPost | null>(feedKeys.opened, (prev) => (prev && prev.id === postId ? change(prev) : prev));
}

/** Takes the post out of every cached list (each tab's pages, the saved list) and keeps it out for this session. */
function dropPost(client: QueryClient, postId: string): void {
  hidePostThisSession(postId);
  client.setQueriesData<FeedPages>({ queryKey: feedKeys.posts }, (prev) => removeFeedPost(prev, postId));
  client.setQueryData<FeedPost[]>(feedKeys.saved, (prev) => prev?.filter((p) => p.id !== postId));
  client.setQueryData<FeedPost | null>(feedKeys.opened, (prev) => (prev && prev.id === postId ? null : prev));
}

/**
 * Registers the queued writes of Akış F1 (see `sync/featureMutations`): like and save are optimistic, survive
 * offline periods and restarts, and are sent in order with the other tenant writes.
 */
export function registerFeedMutations(client: QueryClient): void {
  // PUT (like) / DELETE (unlike) v1/tenant/feed-post/{id}/like → { liked, likeCount }
  client.setMutationDefaults(feedMutationKeys.like, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: LikeFeedPostRequest) =>
      fromSource<FeedLikeWire>(
        'content',
        () => feedFixtures.like(vars.postId, vars.liked),
        () => apiRequest<FeedLikeWire>(`${postPath(vars.postId)}/like`, { method: vars.liked ? 'PUT' : 'DELETE' }),
      ),
    onMutate: async (vars: LikeFeedPostRequest) => {
      await client.cancelQueries({ queryKey: feedKeys.posts });
      patchPost(client, vars.postId, (p) => applyLike(p, vars.liked));
    },
    // The server's count replaces the optimistic one — unless a newer toggle is already on its way.
    onSuccess: (result: FeedLikeWire | undefined, vars: LikeFeedPostRequest) => {
      if (!result) return;
      patchPost(client, vars.postId, (p) => (p.liked === result.liked ? { ...p, likeCount: result.likeCount } : p));
    },
    onError: () => void client.invalidateQueries({ queryKey: feedKeys.posts }),
  });

  // PUT (save) / DELETE (remove) v1/tenant/feed-post/{id}/save → 204
  client.setMutationDefaults(feedMutationKeys.save, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: SaveFeedPostRequest) =>
      fromSource<void>(
        'content',
        () => feedFixtures.save(vars.postId, vars.saved),
        () => apiRequest<void>(`${postPath(vars.postId)}/save`, { method: vars.saved ? 'PUT' : 'DELETE' }),
      ),
    onMutate: async (vars: SaveFeedPostRequest) => {
      await client.cancelQueries({ queryKey: feedKeys.posts });
      await client.cancelQueries({ queryKey: feedKeys.saved });
      patchPost(client, vars.postId, (p) => ({ ...p, saved: vars.saved }));
      // "Kaydı kaldır" on Kaydedilenler: the card leaves at once.
      if (!vars.saved) client.setQueryData<FeedPost[]>(feedKeys.saved, (prev) => prev?.filter((p) => p.id !== vars.postId));
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: feedKeys.saved }),
    onError: () => {
      void client.invalidateQueries({ queryKey: feedKeys.posts });
      void client.invalidateQueries({ queryKey: feedKeys.saved });
    },
  });

  // PUT v1/tenant/feed-post/{id}/hide → 204 ("Bunu gösterme", Akış F2). The post left the lists when the user tapped.
  client.setMutationDefaults(feedMutationKeys.hide, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: HideFeedPostRequest) =>
      fromSource<void>(
        'content',
        () => feedFixtures.hide(vars.postId),
        () => apiRequest<void>(`${postPath(vars.postId)}/hide`, { method: 'PUT' }),
      ),
    onMutate: async (vars: HideFeedPostRequest) => {
      await client.cancelQueries({ queryKey: feedKeys.posts });
      await client.cancelQueries({ queryKey: feedKeys.saved });
      dropPost(client, vars.postId);
    },
  });

  // POST v1/tenant/feed-post/{id}/report { reason, note? } → 201 { reportId } (Akış F2). The post is hidden on this device too.
  client.setMutationDefaults(feedMutationKeys.report, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: ReportFeedPostRequest) =>
      fromSource<unknown>(
        'content',
        () => feedFixtures.report(vars.postId, vars.reason, vars.note ?? null),
        () =>
          apiRequest<{ reportId: string }>(`${postPath(vars.postId)}/report`, {
            method: 'POST',
            body: { reason: fromReportReason(vars.reason), ...(vars.note ? { note: vars.note.slice(0, 500) } : {}) },
          }),
      ),
    onMutate: async (vars: ReportFeedPostRequest) => {
      await client.cancelQueries({ queryKey: feedKeys.posts });
      await client.cancelQueries({ queryKey: feedKeys.saved });
      dropPost(client, vars.postId);
    },
  });

  // POST v1/tenant/feed-post/{id}/look { mode, requestId } → 201 LookDto (200: the look already made of this post in this
  // mode). "Looklarıma ekle" (owner decision 2026-11-23). Not optimistic: the look (and, with its pieces, the new
  // wardrobe items) exist once the server answers; the toast then offers "Gör".
  client.setMutationDefaults(feedMutationKeys.saveAsLook, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: SaveFeedPostAsLookRequest) =>
      fromSource<Look>(
        'content',
        () => feedFixtures.saveAsLook(vars.postId, vars.mode, vars.requestId),
        async () => {
          const wire = await apiRequest<LookWire>(`${postPath(vars.postId)}/look`, { method: 'POST', body: { mode: vars.mode, requestId: vars.requestId } });
          // The look's slots are joined with the wardrobe: the pieces just added must be read first.
          if (vars.mode === 'pieces') await client.invalidateQueries({ queryKey: wardrobeKeys.items });
          return toLookAsync(wire);
        },
      ),
    onSuccess: (look: Look | undefined, vars: SaveFeedPostAsLookRequest) => {
      if (!look) return;
      client.setQueryData<Look[]>(lookKeys.looks, (prev) => (prev ? [look, ...prev.filter((l) => l.id !== look.id)] : prev));
      client.setQueryData<Look>(lookKeys.look(look.id), look);
      void client.invalidateQueries({ queryKey: lookKeys.looks });
      if (vars.mode === 'pieces') void client.invalidateQueries({ queryKey: wardrobeKeys.items });
      track('feed_save_as_look', { postId: vars.postId, mode: vars.mode });
      toast.success(i18n.t('homeFeed.lookSheet.savedToast'), {
        action: { label: i18n.t('feedback.see'), onPress: () => router.push({ pathname: '/look/[id]', params: { id: look.id } }) },
        testID: 'toast-feed-look',
      });
    },
    onError: (error: unknown) => {
      const key = saveAsLookErrorKey(error);
      // The plan's limit is answered like every other way of adding a piece: the paywall.
      if (key === 'paywall') openPaywall({ from: 'feed_save_as_look' });
      else toast.error(i18n.t(`homeFeed.lookSheet.errors.${key}`), { testID: 'toast-feed-look-error' });
    },
  });
}

const id = () => newClientMutation().clientMutationId;

/**
 * Opens a post's detail (`feed/[id]`) from its card. The detail has no read of its own: it draws the post from the
 * cache, so the tapped copy is kept for it (`feedKeys.opened`) in case the post leaves the lists while it is open.
 */
export function useOpenFeedPost() {
  const client = useQueryClient();
  return (post: FeedPost) => {
    client.setQueryData<FeedPost | null>(feedKeys.opened, post);
    track('feed_post_open', { postId: post.id, kind: post.kind });
    router.push({ pathname: '/feed/[id]', params: { id: post.id } });
  };
}

/** "Kendi parçalarımla kur": the look builder (15) with the wardrobe pieces matched to the post, and its occasion. */
export function openBuildWithMine(post: Pick<FeedPost, 'id' | 'products' | 'occasion'>): void {
  const mine = ownedItemIds(post);
  track('feed_build_with_mine', { postId: post.id, count: mine.length });
  router.push({ pathname: '/look/new', params: { itemIds: mine.join(','), ...(post.occasion ? { occasion: post.occasion } : {}) } });
}

/** ♡ on a post: optimistic, queued offline. */
export function useLikeFeedPost() {
  const m = useMutation<FeedLikeWire, unknown, LikeFeedPostRequest>({ mutationKey: feedMutationKeys.like });
  return (post: Pick<FeedPost, 'id'>, liked: boolean) => {
    m.mutate({ postId: post.id, liked, clientMutationId: id() });
    track('feed_like', { postId: post.id, liked });
  };
}

/** "Kaydet" on a post: optimistic, queued offline; the toast links to Kaydedilenler › Akış (teens too: they see only that list). */
export function useSaveFeedPost() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const m = useMutation<void, unknown, SaveFeedPostRequest>({ mutationKey: feedMutationKeys.save });
  return (post: Pick<FeedPost, 'id'>, saved: boolean) => {
    m.mutate({ postId: post.id, saved, clientMutationId: id() });
    track('feed_save', { postId: post.id, saved });
    // A newly saved post shows on Kaydedilenler the next time it opens.
    if (saved) void client.invalidateQueries({ queryKey: feedKeys.saved, refetchType: 'none' });
    toast.success(t(saved ? 'homeFeed.savedToast' : 'homeFeed.unsavedToast'), {
      action: saved ? { label: t('feedback.see'), onPress: () => router.push({ pathname: '/friends/saved', params: { tab: 'feed' } }) } : undefined,
      testID: 'toast-feed-save',
    });
  };
}

/** "Bunu gösterme" on a member's post: it leaves the list at once (no undo), the write is queued offline. */
export function useHideFeedPost() {
  const { t } = useTranslation();
  const m = useMutation<void, unknown, HideFeedPostRequest>({ mutationKey: feedMutationKeys.hide });
  return (post: Pick<FeedPost, 'id'>) => {
    m.mutate({ postId: post.id, clientMutationId: id() });
    track('feed_hide', { postId: post.id });
    toast.success(t('homeFeed.hiddenToast'), { testID: 'toast-feed-hide' });
  };
}

/** "Şikâyet et" on a member's post: queued offline; the post is hidden on this device and the toast confirms. */
export function useReportFeedPost() {
  const { t } = useTranslation();
  const m = useMutation<unknown, unknown, ReportFeedPostRequest>({ mutationKey: feedMutationKeys.report });
  return (post: Pick<FeedPost, 'id'>, reason: ReportReason) => {
    m.mutate({ postId: post.id, reason, clientMutationId: id() });
    track('feed_report', { postId: post.id, reason });
    toast.success(t('homeFeed.reportedToast'), { testID: 'toast-feed-report' });
  };
}

/**
 * "Looklarıma ekle" on an editor post: resolves true once the server made the look (the sheet closes; the toast with
 * "Gör" comes from the write itself), false when it failed (the sheet stays; the toast or the paywall said why).
 * Offline the write is queued like the other feed writes and the toast says so. `saving` = the mode on its way.
 */
export function useSaveFeedPostAsLook() {
  const { t } = useTranslation();
  const online = useIsOnline();
  const m = useMutation<Look, unknown, SaveFeedPostAsLookRequest>({ mutationKey: feedMutationKeys.saveAsLook });
  const [saving, setSaving] = useState<FeedLookMode | null>(null);
  const save = async (post: Pick<FeedPost, 'id'>, mode: FeedLookMode): Promise<boolean> => {
    const vars: SaveFeedPostAsLookRequest = { postId: post.id, mode, requestId: ulid() };
    if (!online) {
      m.mutate(vars);
      toast.info(t('homeFeed.lookSheet.queuedToast'), { testID: 'toast-feed-look-queued' });
      return true;
    }
    setSaving(mode);
    try {
      await m.mutateAsync(vars);
      return true;
    } catch {
      return false;
    } finally {
      setSaving(null);
    }
  };
  return { save, saving };
}
