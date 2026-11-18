import type { Money } from '@/lib/format';

import type { Occasion, StyleTag } from '../contracts';

/**
 * E9 — Sosyal (25–27): the app-side types the screens render.
 *
 * The wire shapes (docs/api/store-social-settings.md §6) and the mappers live in `../wire/social`.
 * Every read is already filtered by the server's VisibilityPolicy; the app only shows what comes
 * back (a refused read is 404 — indistinguishable from "does not exist"). Other people's looks are
 * shown with piece images — never a try-on image. The backend has no avatars: `avatarUrl` is null.
 */

export type PersonRef = { handle: string; displayName: string; avatarUrl: string | null };

/** Story-ring row of 25. Not a backend concept: derived from the authors of the loaded feed page. */
export type FeedStory = PersonRef & { hasNew: boolean };

/** One piece of another person's look ("Parçaları gör"). `slot` uses the app's look-slot keys (`accessory`). */
export type FeedPiece = {
  slot: string;
  itemId: string | null;
  /** Set for catalogue pieces — can be added to the cart with `look: { kind: 'user', id: lookId }`. */
  productId: string | null;
  name: string;
  imageUrl: string | null;
  brandName: string | null;
  price: Money | null;
  /** Category / main colour (wardrobe or catalogue vocabulary), when known: the placeholder while there is no picture. */
  category?: string | null;
  color?: string | null;
};

export type FeedLook = {
  lookId: string;
  name?: string;
  author: PersonRef & { isFollowing: boolean };
  occasion: Occasion | null;
  postedAt: string;
  /** Cover: the first piece image (never a try-on image). */
  imageUrl: string | null;
  pieces?: FeedPiece[];
  /** This user's rating (1–5), if any. */
  myRating: number | null;
  averageRating: number | null;
  ratingCount: number;
  saved: boolean;
};
/** GET v1/tenant/feed?pageToken= → `{ items, pageToken }` (20 per page), mapped; `stories` only on the first page. */
export type FeedPage = { stories: FeedStory[]; items: FeedLook[]; nextPageToken: string | null };

/**
 * PUT v1/tenant/people/{handle}/look/{lookId}/rating `{ score, clientMutationId }` → `{ average, count, myScore }`.
 * One rating per person per look; a new score overwrites. 404 hidden / gone, 422 `cannot_target_self`.
 */
export type RateLookRequest = { handle: string; lookId: string; score: number; clientMutationId: string };
/** PUT (save) / DELETE (remove) v1/tenant/people/{handle}/look/{lookId}/save → 204, no body. */
export type SaveLookRequest = { handle: string; lookId: string; saved: boolean; clientMutationId: string };

/** POST / DELETE v1/tenant/follow/{handle} → 204, no body. 422 `cannot_target_self`, `follow_limit_reached` (500). */
export type FollowRequest = { handle: string; follow: boolean; clientMutationId: string };

/** GET v1/tenant/people/{handle} (mapped from `PersonProfileDto`). */
export type PersonProfile = PersonRef & {
  styleTags: StyleTag[];
  /** Null when the closet is hidden from this viewer. */
  itemCount: number | null;
  lookCount: number | null;
  /** 0–100 (`styleMatchPercent`). */
  styleMatch: number;
  isFollowing: boolean;
  /** The server's decision for this viewer (`!closetLocked`; public / followers-only / private already applied). */
  closetVisible: boolean;
  isSelf?: boolean;
  followsYou?: boolean;
  followerCount?: number;
  followingCount?: number;
};

/** GET v1/tenant/people/{handle}/look · /item — 404 when hidden. */
export type PersonTile = {
  id: string;
  name: string;
  imageUrl: string | null;
  /** Item tiles: category / main colour (wardrobe vocabulary), when sent — the placeholder while there is no picture. */
  category?: string | null;
  color?: string | null;
};
/** GET v1/tenant/people/{handle}/trip — finished trips only: city + month (`YYYY-MM`). Owner-only for now. */
export type PersonTrip = { id: string; city: string; month: string };

/**
 * `PersonCardDto`: GET v1/tenant/people?q= (handle prefix, min 2 chars, max 20) · /people/suggested ·
 * v1/tenant/follower · v1/tenant/following · v1/tenant/block.
 */
export type PersonSuggestion = PersonRef & {
  styleMatch: number;
  isFollowing: boolean;
  followsYou?: boolean;
  styleTags?: StyleTag[];
};

/** Shortest search text the server accepts (the leading `@` does not count). */
export const PEOPLE_SEARCH_MIN = 2;

/** GET v1/tenant/invite/link */
export type InviteLink = { url: string; code: string; invitedCount?: number };
/**
 * POST v1/tenant/invite/attribution `{ code }` → 204 — applies an invite code captured before sign-up.
 * 404 `invite_code_not_found`, 409 `invite_already_attributed`, 422 `cannot_target_self` /
 * `invite_window_closed` are final answers (never retried).
 */
export type AcceptInviteRequest = { code: string; clientMutationId: string };

/** The server's report reasons (wire: camelCase, `minorSafety`). */
export const REPORT_REASONS = ['inappropriate', 'harassment', 'impersonation', 'minor_safety', 'spam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
/**
 * POST v1/tenant/people/{handle}/report `{ targetKind, targetId?, reason, note? }` → 201 `{ reportId }`.
 * `target` defaults to the profile; a look / item report carries its id. 429 `too_many_attempts` (20 / day).
 */
export type ReportRequest = {
  handle: string;
  reason: ReportReason;
  target?: { kind: 'profile' } | { kind: 'look' | 'item'; id: string };
  note?: string;
  clientMutationId: string;
};
/** PUT (block) / DELETE (unblock) v1/tenant/block/{handle} → 204. Blocking removes follows in both directions. */
export type BlockRequest = { handle: string; clientMutationId: string };

/** What is being shared (POST v1/tenant/share); the server answers with the link to send. */
export type ShareTarget =
  | { targetKind: 'app' }
  | { targetKind: 'profile'; ownerHandle: string }
  | { targetKind: 'look' | 'product' | 'edit'; targetId: string; ownerHandle?: string };
