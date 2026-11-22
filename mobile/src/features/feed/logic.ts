import type { InfiniteData } from '@tanstack/react-query';
import type { TFunction } from 'i18next';

import type { FeedPost, FeedPostPage, FeedProduct } from '@/api/contracts/feed';
import { feedTabOfOccasion } from '@/api/wire/feed';
import { relativeTime, seasonOf } from '@/lib/format';

/** Applies `change` to every post matching `match`, across all loaded pages. */
export function updateFeedPosts<T extends InfiniteData<FeedPostPage, unknown>>(
  data: T | undefined,
  match: (post: FeedPost) => boolean,
  change: (post: FeedPost) => FeedPost,
): T | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map((p) => (match(p) ? change(p) : p)) })) };
}

/** The loaded pages without one post ("Bunu gösterme", a report). */
export function removeFeedPost<T extends InfiniteData<FeedPostPage, unknown>>(data: T | undefined, postId: string): T | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.filter((p) => p.id !== postId) })) };
}

/**
 * Posts this user hid or reported in this app session. The lists leave them out even when a refetch lands before the
 * queued write reached the server (offline), or when the server keeps showing a reported post until it is reviewed.
 */
const hiddenThisSession = new Set<string>();

export function hidePostThisSession(postId: string): void {
  hiddenThisSession.add(postId);
}

export function isHiddenThisSession(postId: string): boolean {
  return hiddenThisSession.has(postId);
}

/** Wardrobe items behind the "Gardırobunda var" pieces of an editor post ("Kendi parçalarımla kur" needs two). */
export function ownedItemIds(post: Pick<FeedPost, 'products'>): string[] {
  return [...new Set(post.products.filter((p) => p.ownedSimilar && p.ownedItemId).map((p) => p.ownedItemId as string))];
}

export const BUILD_WITH_MINE_MIN = 2;

/** The post after this user likes / unlikes it (optimistic; the server's count replaces it). */
export function applyLike(post: FeedPost, liked: boolean): FeedPost {
  if (post.liked === liked) return post;
  return { ...post, liked, likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)) };
}

/** "Look'taki ürünler": products that can be bought and that the user does not already own. */
export function buyableProducts(post: Pick<FeedPost, 'products'>): FeedProduct[] {
  return post.products.filter((p) => !p.ownedSimilar && p.available !== false);
}

/** "GARDIROBUNDA VAR": products the user already has something similar to. */
export function ownedProducts(post: Pick<FeedPost, 'products'>): FeedProduct[] {
  return post.products.filter((p) => p.ownedSimilar);
}

/** "3 sa" / "3h" — the compact age of a post or story. */
export function shortAge(t: TFunction, iso: string, now: Date = new Date()): string {
  const when = relativeTime(iso, now);
  if (when.unit === 'now') return t('homeFeed.ageNow');
  if (when.unit === 'minutes') return t('homeFeed.ageMinutes', { count: when.count });
  if (when.unit === 'hours') return t('homeFeed.ageHours', { count: when.count });
  return t('homeFeed.ageDays', { count: when.count });
}

/** The post's occasion as the feed names it ("Ofis", "Hafta sonu", "Davet"); null without one. */
export function occasionLabel(t: TFunction, occasion: FeedPost['occasion']): string | null {
  if (!occasion) return null;
  const tab = feedTabOfOccasion(occasion);
  return tab ? t(`homeFeed.tabs.${tab}`) : t(`occasion.${occasion}`);
}

/**
 * Meta line under the author: "Ofis · Sonbahar · 3 sa" (Droblet Edit) or "Seçili stilist · Hafta sonu · 5 sa"
 * (a stylist, as on the board); a member's look: "Topluluk · Hafta sonu · 1 sa" (Akış F2).
 */
export function postMeta(t: TFunction, post: Pick<FeedPost, 'author' | 'occasion' | 'publishedAt'>, now: Date = new Date()): string {
  const parts: string[] = [];
  if (post.author.kind === 'stylist') parts.push(t('homeFeed.selectedStylist'));
  if (post.author.kind === 'user') parts.push(t('homeFeed.community'));
  const occasion = occasionLabel(t, post.occasion);
  if (occasion) parts.push(occasion);
  if (post.author.kind === 'edit') {
    const published = new Date(post.publishedAt);
    if (!Number.isNaN(published.getTime())) parts.push(t(`season.${seasonOf(published)}`));
  }
  parts.push(shortAge(t, post.publishedAt, now));
  return parts.join(' · ');
}

/** Posts already reported as viewed in this app session (`feed_post_view` fires once per post per session). */
const viewedThisSession = new Set<string>();

/** True the first time a post is seen in this session (and remembers it). */
export function firstViewThisSession(postId: string): boolean {
  if (viewedThisSession.has(postId)) return false;
  viewedThisSession.add(postId);
  return true;
}

/** Test helper. */
export function resetFeedSession(): void {
  viewedThisSession.clear();
  hiddenThisSession.clear();
}
