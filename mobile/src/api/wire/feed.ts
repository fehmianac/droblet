/**
 * Wire shapes of Akış F1 (`v1/content/feed`, `v1/content/feed/story`, `v1/tenant/feed-post/{id}/like|save`,
 * `v1/tenant/feed-post/saved`) and the mappers to the app types in `../contracts/feed`.
 */
import type { Occasion } from '../contracts';
import type { EditorStory, FeedPiece, FeedPost, FeedPostPage, FeedProduct, FeedTab } from '../contracts/feed';
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

/** `ownedItemId`: the wardrobe item behind `ownedSimilar` (older servers omit it). */
export type FeedProductWire = ProductWire & { ownedSimilar?: boolean | null; ownedItemId?: string | null };

export type FeedAuthorWire = {
  /** `user` (Akış F2): `name` is "@handle", `handle` and `imageUrl` are the member's. */
  kind: 'edit' | 'stylist' | 'user';
  name: string;
  handle: string | null;
  imageUrl: string | null;
  verified: boolean;
};

/** `subcategory`: a `SubcategoryCatalog` id ("trench-coat"); null or left out when unknown. */
export type FeedPieceWire = { category: string; subcategory?: string | null; imageUrl: string | null };

/** `FeedPostDto`. */
export type FeedPostWire = {
  id: string;
  /** Akış F2; older servers omit it (= `editor`). */
  kind?: 'editor' | 'user' | null;
  author: FeedAuthorWire;
  occasion: string | null;
  publishedAt: string;
  title: string;
  note: string | null;
  images: string[] | null;
  products: FeedProductWire[] | null;
  /** A member's look: its pieces. An editor photograph without products: the pieces cut out of it. `[]` otherwise; older servers omit it. */
  pieces?: FeedPieceWire[] | null;
  hasSimilar?: boolean | null;
  canTryOn?: boolean | null;
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
  return { ...toProductSummary(wire), ownedSimilar: Boolean(wire.ownedSimilar), ownedItemId: wire.ownedItemId || null };
}

export function toFeedPiece(wire: FeedPieceWire): FeedPiece {
  return { category: wire.category, subcategory: wire.subcategory || null, imageUrl: wire.imageUrl ?? null };
}

export function toFeedPost(wire: FeedPostWire): FeedPost {
  const handle = wire.author.handle ? wire.author.handle.replace(/^@/, '') : null;
  // A member's post is one only when both the post and its author say so; anything else is editorial.
  const user = wire.kind === 'user' && wire.author.kind === 'user';
  return {
    id: wire.id,
    kind: user ? 'user' : 'editor',
    author: {
      kind: user ? 'user' : wire.author.kind === 'stylist' ? 'stylist' : 'edit',
      name: wire.author.name,
      handle,
      imageUrl: wire.author.imageUrl ?? null,
      // No verified mark on a member (decision 21).
      verified: !user && Boolean(wire.author.verified),
    },
    occasion: toOccasion(wire.occasion),
    publishedAt: wire.publishedAt,
    title: wire.title,
    note: wire.note ?? null,
    images: (wire.images ?? []).filter((url) => typeof url === 'string' && url.length > 0),
    // A member's look sells nothing: no products, no buyable count, no try-on (decision 21).
    products: user ? [] : (wire.products ?? []).map(toFeedProduct),
    // An editor post that is a photograph without products carries its pieces too (owner decision 2026-11-23).
    pieces: (wire.pieces ?? []).map(toFeedPiece),
    hasSimilar: Boolean(wire.hasSimilar),
    canTryOn: user ? false : (wire.canTryOn ?? true),
    buyableCount: user ? 0 : Math.max(0, wire.buyableCount ?? 0),
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
