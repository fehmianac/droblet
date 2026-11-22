import type { Occasion } from '../contracts';
import type { ReportReason } from './social';
import type { ProductSummary } from './store';

/**
 * Akış F1 (canvas 06″, decisions 16–19): the home feed of editorial content — Droblet Edit and selected stylists,
 * published from the admin panel. App-side types; the wire shapes and mappers live in `../wire/feed`.
 *
 * Interactions are only like (♡), save, "Üzerimde dene" and buy (decision 18). No comments (decision 19), no share,
 * no follow, no try-on counts, no sponsored items in F1. (The friends' feed `v1/tenant/feed` is unrelated: E9.)
 */

/** "Senin için" tabs: Tümü · Ofis · Hafta sonu · Davet. `all` sends no filter. */
export const FEED_TABS = ['all', 'office', 'weekend', 'invite'] as const;
export type FeedTab = (typeof FEED_TABS)[number];

/** Page size of `GET v1/content/feed` (set by the server). */
export const FEED_PAGE_SIZE = 10;

export type FeedAuthor = {
  /** `edit` = Droblet Edit (the verified house account), `stylist` = a selected stylist, `user` = a member (Akış F2). */
  kind: 'edit' | 'stylist' | 'user';
  /** A member's name is their "@handle". */
  name: string;
  /** Without the leading @; null for the house account. */
  handle: string | null;
  imageUrl: string | null;
  verified: boolean;
};

/** A catalogue product of a post. `ownedSimilar`: the user already has a similar piece ("Gardırobunda var"). */
export type FeedProduct = ProductSummary & {
  ownedSimilar: boolean;
  /** The wardrobe item that matches (drives "Kendi parçalarımla kur"); null when unknown. */
  ownedItemId: string | null;
};

/** One piece of a member's look on Akış (F2): its picture and what kind of piece it is — never a product, never tappable. */
export type FeedPiece = { category: string; imageUrl: string | null };

/** Akış F2 (decision 21): `editor` = Droblet Edit / a stylist, `user` = a look a member shared with "Akışta paylaş". */
export type FeedPostKind = 'editor' | 'user';

export type FeedPost = {
  id: string;
  kind: FeedPostKind;
  author: FeedAuthor;
  occasion: Occasion | null;
  publishedAt: string;
  title: string;
  note: string | null;
  /** Editorial photos, in carousel order (may be empty → the look placeholder). */
  images: string[];
  products: FeedProduct[];
  /** A member's look: its pieces (picture + kind). Empty on editor posts. */
  pieces: FeedPiece[];
  /** The catalogue has products like this look's pieces ("Benzerlerini gör"). */
  hasSimilar: boolean;
  /** "Üzerimde dene" is offered (never on a member's look — decision 21). */
  canTryOn: boolean;
  /** Products that can be bought on the brand site (server count; drives "Satın alınabilir · N parça"). */
  buyableCount: number;
  likeCount: number;
  liked: boolean;
  saved: boolean;
};

/** `GET v1/content/feed?occasion=&pageToken=` → `{ items, pageToken }`. */
export type FeedPostPage = { items: FeedPost[]; nextPageToken: string | null };

/** `GET v1/content/feed/story` — one editor story (full-screen viewer). */
export type EditorStory = {
  id: string;
  author: { name: string; imageUrl: string | null };
  imageUrl: string | null;
  headline: string;
  product: ProductSummary | null;
  publishedAt: string;
};

/** PUT (like) / DELETE (unlike) `v1/tenant/feed-post/{id}/like` → `{ liked, likeCount }`. Queued offline. */
export type LikeFeedPostRequest = { postId: string; liked: boolean; clientMutationId: string };
/** PUT (save) / DELETE (remove) `v1/tenant/feed-post/{id}/save` → 204. Queued offline. */
export type SaveFeedPostRequest = { postId: string; saved: boolean; clientMutationId: string };
/** PUT `v1/tenant/feed-post/{id}/hide` → 204 ("Bunu gösterme": the post leaves this user's feed). Queued offline. */
export type HideFeedPostRequest = { postId: string; clientMutationId: string };
/** POST `v1/tenant/feed-post/{id}/report` `{ reason, note? }` → 201 `{ reportId }`. Reasons = the social report reasons. Queued offline. */
export type ReportFeedPostRequest = { postId: string; reason: ReportReason; note?: string; clientMutationId: string };
