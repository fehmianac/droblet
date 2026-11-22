/**
 * Wire shapes of Akış F1 (`v1/content/feed`, `v1/content/feed/story`, `v1/tenant/feed-post/{id}/like|save`,
 * `v1/tenant/feed-post/saved`) and the mappers to the app types in `../contracts/feed`.
 */
import type { Occasion } from '../contracts';
import type { EditorStory, FeedPost, FeedPostPage, FeedProduct, FeedTab } from '../contracts/feed';
import type { ProductWire } from './catalog';
import { toProductSummary } from './store';
import { toOccasion, type OccasionWire } from './wardrobe';

/**
 * THE one place that says which wire occasions the "Davet" tab shows: the existing `dinner` and `wedding` occasions
 * (owner decision 2026-11-22; docs/api/store-social-settings.md §2b). Sent comma-separated.
 */
export const FEED_INVITE_OCCASIONS: readonly OccasionWire[] = ['dinner', 'wedding'];

/** The occasions a tab shows; null for "Tümü" (no filter). */
export function feedTabOccasions(tab: FeedTab): readonly OccasionWire[] | null {
  switch (tab) {
    case 'office':
      return ['office'];
    case 'weekend':
      return ['weekend'];
    case 'invite':
      return FEED_INVITE_OCCASIONS;
    default:
      return null;
  }
}

/** `?occasion=` of a tab (comma-separated wire names); null for "Tümü" (no filter). */
export function feedOccasionParam(tab: FeedTab): string | null {
  return feedTabOccasions(tab)?.join(',') ?? null;
}

/** The feed tab a post's occasion belongs to (its label in the meta line), null when none matches. */
export function feedTabOfOccasion(occasion: Occasion | null): Exclude<FeedTab, 'all'> | null {
  if (occasion === 'office' || occasion === 'weekend') return occasion;
  if (occasion && (FEED_INVITE_OCCASIONS as readonly string[]).includes(occasion)) return 'invite';
  return null;
}

export type FeedProductWire = ProductWire & { ownedSimilar?: boolean | null };

export type FeedAuthorWire = {
  kind: 'edit' | 'stylist';
  name: string;
  handle: string | null;
  imageUrl: string | null;
  verified: boolean;
};

/** `FeedPostDto`. */
export type FeedPostWire = {
  id: string;
  author: FeedAuthorWire;
  occasion: string | null;
  publishedAt: string;
  title: string;
  note: string | null;
  images: string[] | null;
  products: FeedProductWire[] | null;
  buyableCount: number | null;
  likeCount: number | null;
  liked: boolean | null;
  saved: boolean | null;
};

/** GET v1/content/feed?occasion=&pageToken= */
export type FeedPostPageWire = { items: FeedPostWire[]; pageToken: string | null };

/** `FeedStoryDto` — GET v1/content/feed/story. */
export type FeedStoryWire = {
  id: string;
  author: { name: string; imageUrl: string | null };
  imageUrl: string | null;
  headline: string;
  product: ProductWire | null;
  publishedAt: string;
};

/** PUT / DELETE v1/tenant/feed-post/{id}/like */
export type FeedLikeWire = { liked: boolean; likeCount: number };

export function toFeedProduct(wire: FeedProductWire): FeedProduct {
  return { ...toProductSummary(wire), ownedSimilar: Boolean(wire.ownedSimilar) };
}

export function toFeedPost(wire: FeedPostWire): FeedPost {
  const handle = wire.author.handle ? wire.author.handle.replace(/^@/, '') : null;
  return {
    id: wire.id,
    author: {
      kind: wire.author.kind === 'stylist' ? 'stylist' : 'edit',
      name: wire.author.name,
      handle,
      imageUrl: wire.author.imageUrl ?? null,
      verified: Boolean(wire.author.verified),
    },
    occasion: toOccasion(wire.occasion),
    publishedAt: wire.publishedAt,
    title: wire.title,
    note: wire.note ?? null,
    images: (wire.images ?? []).filter((url) => typeof url === 'string' && url.length > 0),
    products: (wire.products ?? []).map(toFeedProduct),
    buyableCount: Math.max(0, wire.buyableCount ?? 0),
    likeCount: Math.max(0, wire.likeCount ?? 0),
    liked: Boolean(wire.liked),
    saved: Boolean(wire.saved),
  };
}

export function toFeedPostPage(wire: FeedPostPageWire): FeedPostPage {
  return { items: wire.items.map(toFeedPost), nextPageToken: wire.pageToken ?? null };
}

export function toEditorStory(wire: FeedStoryWire): EditorStory {
  return {
    id: wire.id,
    author: { name: wire.author.name, imageUrl: wire.author.imageUrl ?? null },
    imageUrl: wire.imageUrl ?? null,
    headline: wire.headline,
    product: wire.product ? toProductSummary(wire.product) : null,
    publishedAt: wire.publishedAt,
  };
}
