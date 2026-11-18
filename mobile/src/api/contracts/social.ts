import type { Occasion, StyleTag } from '../contracts';

/**
 * E9 — Sosyal (25–27).
 *
 * ⚠ PROVISIONAL — shapes assumed from the endpoint map in BACKEND_ENGINEER.md. Every read is already
 * filtered by the server's VisibilityPolicy; the app only shows what comes back (a refused read is
 * 404). Other people's looks are shown with piece images — never a try-on image.
 */

export type PersonRef = { handle: string; displayName: string; avatarUrl: string | null };

/** GET v1/tenant/feed?pageToken= — assumption: the first page also carries the story ring row. */
export type FeedStory = PersonRef & { hasNew: boolean };
export type FeedLook = {
  lookId: string;
  author: PersonRef & { isFollowing: boolean };
  occasion: Occasion | null;
  postedAt: string;
  imageUrl: string | null;
  /** This user's rating (1–5), if any. */
  myRating: number | null;
  averageRating: number | null;
  ratingCount: number;
  saved: boolean;
};
export type FeedPage = { stories: FeedStory[]; items: FeedLook[]; nextPageToken: string | null };

/** PUT v1/tenant/people/{handle}/look/{lookId}/rating — one rating per person per look, overwrites. */
export type RateLookRequest = { handle: string; lookId: string; score: number; clientMutationId: string };
/** ASSUMED: PUT v1/tenant/people/{handle}/look/{lookId}/save */
export type SaveLookRequest = { handle: string; lookId: string; saved: boolean; clientMutationId: string };

/** POST / DELETE v1/tenant/follow/{handle} */
export type FollowRequest = { handle: string; follow: boolean; clientMutationId: string };

/** GET v1/tenant/people/{handle} */
export type PersonProfile = PersonRef & {
  styleTags: StyleTag[];
  /** Null when the closet is hidden from this viewer. */
  itemCount: number | null;
  lookCount: number | null;
  /** 0–100 */
  styleMatch: number;
  isFollowing: boolean;
  /** The server's decision for this viewer (public / followers-only / private already applied). */
  closetVisible: boolean;
};

/** GET v1/tenant/people/{handle}/look · /item — 404 when hidden. */
export type PersonTile = { id: string; name: string; imageUrl: string | null };
/** GET v1/tenant/people/{handle}/trip — finished trips only: city + month (`YYYY-MM`). */
export type PersonTrip = { id: string; city: string; month: string };

/** GET v1/tenant/people?q= (prefix search) · GET v1/tenant/people/suggested */
export type PersonSuggestion = PersonRef & { styleMatch: number; isFollowing: boolean };

/** GET v1/tenant/invite/link */
export type InviteLink = { url: string; code: string };
/** ASSUMED: POST v1/tenant/invite/accept — applies an invite code captured before sign-up. */
export type AcceptInviteRequest = { code: string; clientMutationId: string };

export const REPORT_REASONS = ['inappropriate', 'harassment', 'fake', 'unauthorized_photo', 'spam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
/** ASSUMED: POST v1/tenant/people/{handle}/report */
export type ReportRequest = { handle: string; reason: ReportReason; clientMutationId: string };
/** ASSUMED: POST v1/tenant/people/{handle}/block */
export type BlockRequest = { handle: string; clientMutationId: string };
