/**
 * Wire shapes of the social endpoints (docs/api/store-social-settings.md §6, `src/Api/Endpoints/V1/Tenant/
 * {Feed,People,Follow,Block,SavedLook,Invite,Share}`) and the mappers to the app types in
 * `../contracts/social`.
 *
 * What the backend does not have, and how the app fills it:
 * - avatars: there are none — `avatarUrl` is always null (the Avatar shows the initial);
 * - the story-ring row of the feed: derived from the authors of the loaded feed page;
 * - a look image: other people's looks are shown with piece images, never a try-on image, so the
 *   cover is the first piece that has an image.
 */
import type { Occasion, StyleTag } from '../contracts';
import type {
  FeedLook,
  FeedPage,
  FeedPiece,
  FeedStory,
  FollowRequestEntry,
  FollowState,
  InviteLink,
  PersonProfile,
  PersonSuggestion,
  PersonTile,
  PersonTrip,
  ReportReason,
} from '../contracts/social';
import type { ProductWire } from './catalog';
import { toCamel, toSnake } from './core';

// ---------- people ----------

/** `PersonCardDto` — search, suggested, followers, following, blocked. */
export type PersonCardWire = {
  handle: string;
  displayName: string | null;
  styleTags: string[];
  /** Jaccard of the two style-tag sets: 3 shared = 100, 2 = 50, 1 = 20, 0 = 0. */
  styleMatchPercent: number;
  isFollowing: boolean;
  followsYou: boolean;
  /** `none` | `requested` (pending approval) | `following`. Older servers omit it → derived from `isFollowing`. */
  followState?: FollowState;
  /** They have a pending follow request to me. */
  requestedYou?: boolean;
};

/** `PersonProfileDto` — GET v1/tenant/people/{handle}. */
export type PersonProfileWire = PersonCardWire & {
  isSelf: boolean;
  closetVisibility: 'public' | 'followersOnly' | 'private';
  /** true → the "gizli dolap" state; the look / item calls would answer 404. */
  closetLocked: boolean;
  /** null while locked — counts do not leak. */
  itemCount: number | null;
  lookCount: number | null;
  followerCount: number;
  followingCount: number;
};

const styleTags = (tags: string[] | null | undefined): StyleTag[] => (tags ?? []).map((t) => toSnake<StyleTag>(t));

/** The follow state of a card / profile; a server without `followState` only knows following or not. */
export function followStateOf(wire: Pick<PersonCardWire, 'isFollowing' | 'followState'>): FollowState {
  return wire.followState ?? (wire.isFollowing ? 'following' : 'none');
}

export function toPersonSuggestion(wire: PersonCardWire): PersonSuggestion {
  const followState = followStateOf(wire);
  return {
    handle: wire.handle,
    displayName: wire.displayName ?? `@${wire.handle}`,
    avatarUrl: null,
    styleMatch: wire.styleMatchPercent ?? 0,
    isFollowing: followState === 'following',
    followState,
    requestedYou: wire.requestedYou ?? false,
    followsYou: wire.followsYou,
    styleTags: styleTags(wire.styleTags),
  };
}

/** `FollowRequestDto` — GET v1/tenant/follow-request/incoming · /outgoing. */
export type FollowRequestWire = { person: PersonCardWire; createdAt: string };

export function toFollowRequest(wire: FollowRequestWire): FollowRequestEntry {
  return { person: toPersonSuggestion(wire.person), createdAt: wire.createdAt };
}

/** POST v1/tenant/follow/{handle} → 200. */
export type FollowResultWire = { state: 'following' | 'requested' };

export function toPersonProfile(wire: PersonProfileWire): PersonProfile {
  const followState = followStateOf(wire);
  return {
    handle: wire.handle,
    displayName: wire.displayName ?? `@${wire.handle}`,
    avatarUrl: null,
    styleTags: styleTags(wire.styleTags),
    itemCount: wire.itemCount,
    lookCount: wire.lookCount,
    styleMatch: wire.styleMatchPercent ?? 0,
    isFollowing: followState === 'following',
    followState,
    requestedYou: wire.requestedYou ?? false,
    closetVisibility: wire.closetVisibility === 'followersOnly' ? 'followers' : wire.closetVisibility,
    closetVisible: !wire.closetLocked,
    isSelf: wire.isSelf,
    followsYou: wire.followsYou,
    followerCount: wire.followerCount,
    followingCount: wire.followingCount,
  };
}

// ---------- looks ----------

export type SocialPieceWire = {
  /** Wardrobe `OutfitSlot`: top | bottom | outerwear | shoes | bagAccessory. */
  slot: string;
  itemId: string | null;
  productId: string | null;
  name: string | null;
  /** Cleaned item image (short-lived) or the public library / catalogue image; never the original photo. */
  imageUrl: string | null;
  /** Set for catalogue pieces → "Parçaları gör" can add it to the cart. */
  product: ProductWire | null;
};

/** `SocialLookDto` — feed, people/{handle}/look, saved-look. */
export type SocialLookWire = {
  id: string;
  ownerHandle: string;
  ownerDisplayName: string | null;
  name: string | null;
  occasion: string | null;
  createdAt: string;
  pieces: SocialPieceWire[];
  /** `average` is null when `count` is 0; one decimal. */
  rating: { average: number | null; count: number; myScore: number | null } | null;
  saved: boolean;
};

/** PUT v1/tenant/people/{handle}/look/{lookId}/rating → the new summary. */
export type RatingWire = { average: number | null; count: number; myScore: number | null };

/** GET v1/tenant/feed?pageToken= */
export type FeedPageWire = { items: SocialLookWire[]; pageToken: string | null };

function toPiece(wire: SocialPieceWire): FeedPiece {
  return {
    slot: wire.slot === 'bagAccessory' ? 'accessory' : wire.slot,
    itemId: wire.itemId,
    productId: wire.productId,
    name: wire.name ?? wire.product?.name ?? '',
    imageUrl: wire.imageUrl ?? wire.product?.images[0] ?? null,
    brandName: wire.product?.brandName ?? null,
    price: wire.product ? { amountMinor: wire.product.priceMinor, currency: wire.product.currency } : null,
    category: wire.product?.category ?? null,
    color: wire.product?.colors[0] ?? null,
  };
}

/** `isFollowing`: true in the feed (it only carries followed people) — pass what is known elsewhere. */
export function toFeedLook(wire: SocialLookWire, isFollowing = true): FeedLook {
  const pieces = wire.pieces.map(toPiece);
  return {
    lookId: wire.id,
    name: wire.name ?? '',
    author: {
      handle: wire.ownerHandle,
      displayName: wire.ownerDisplayName ?? `@${wire.ownerHandle}`,
      avatarUrl: null,
      isFollowing,
    },
    occasion: (wire.occasion as Occasion | null) ?? null,
    postedAt: wire.createdAt,
    imageUrl: pieces.find((p) => p.imageUrl)?.imageUrl ?? null,
    pieces,
    myRating: wire.rating?.myScore ?? null,
    averageRating: wire.rating && wire.rating.count > 0 ? wire.rating.average : null,
    ratingCount: wire.rating?.count ?? 0,
    saved: wire.saved,
  };
}

/** A look counts as "new" in the story ring for a day. */
export const STORY_NEW_MS = 24 * 60 * 60_000;

/** The story-ring row: one entry per author of these looks, newest first; `hasNew` = posted in the last 24 h. */
export function storiesFromLooks(looks: FeedLook[], now: number = Date.now()): FeedStory[] {
  const byHandle = new Map<string, FeedStory>();
  for (const look of looks) {
    const posted = Date.parse(look.postedAt);
    const hasNew = Number.isFinite(posted) && now - posted < STORY_NEW_MS;
    const existing = byHandle.get(look.author.handle);
    if (existing) {
      if (hasNew) existing.hasNew = true;
      continue;
    }
    byHandle.set(look.author.handle, {
      handle: look.author.handle,
      displayName: look.author.displayName,
      avatarUrl: null,
      hasNew,
    });
  }
  return [...byHandle.values()];
}

export function toFeedPage(wire: FeedPageWire, isFirstPage: boolean): FeedPage {
  const items = wire.items.map((l) => toFeedLook(l));
  return { stories: isFirstPage ? storiesFromLooks(items) : [], items, nextPageToken: wire.pageToken ?? null };
}

export function toLookTile(wire: SocialLookWire): PersonTile {
  return {
    id: wire.id,
    name: wire.name ?? '',
    imageUrl: wire.pieces.find((p) => p.imageUrl)?.imageUrl ?? wire.pieces.find((p) => p.product?.images[0])?.product?.images[0] ?? null,
  };
}

/** Row of GET v1/tenant/people/{handle}/item — `category` is the wardrobe `ItemCategory`. */
export type PersonItemWire = { id: string; name: string | null; category: string; colors: string[]; imageUrl: string | null };

export function toItemTile(wire: PersonItemWire): PersonTile {
  return { id: wire.id, name: wire.name ?? '', imageUrl: wire.imageUrl, category: wire.category, color: wire.colors[0] ?? null };
}

/** Row of GET v1/tenant/people/{handle}/trip — finished trips only; owner-only for now (404 for everyone else). */
export type PersonTripWire = { id: string; city: string; month: string };

export function toPersonTrip(wire: PersonTripWire): PersonTrip {
  return { id: wire.id, city: wire.city, month: wire.month };
}

// ---------- report ----------

export type ReportTargetKindWire = 'profile' | 'look' | 'item';

/** POST v1/tenant/people/{handle}/report → 201 `{ reportId }`. `targetId` is required for `look` / `item`. */
export type ReportRequestWire = { targetKind: ReportTargetKindWire; targetId?: string; reason: string; note?: string };

/** `minor_safety` → `minorSafety`. */
export function fromReportReason(reason: ReportReason): string {
  return toCamel(reason);
}

// ---------- invite / share ----------

/** GET v1/tenant/invite/link */
export type InviteLinkWire = { code: string; url: string; invitedCount: number };

export function toInviteLink(wire: InviteLinkWire): InviteLink {
  return { url: wire.url, code: wire.code, invitedCount: wire.invitedCount };
}

/** GET v1/invite/{code} (anonymous). 404 `invite_code_not_found`, 429 `too_many_attempts`. */
export type InviteInfoWire = { code: string; inviterFirstName: string | null };

export type ShareChannelWire = 'whatsapp' | 'pinterest' | 'link';
export type ShareTargetKindWire = 'app' | 'profile' | 'look' | 'product' | 'edit';

/** POST v1/tenant/share — idempotent on `clientMutationId`; `targetId` required for look / product / edit. */
export type ShareRequestWire = {
  clientMutationId: string;
  channel: ShareChannelWire;
  targetKind: ShareTargetKindWire;
  targetId?: string;
  ownerHandle?: string;
};
/** `url` = `{base}/{code}` for `app`, else `{base}/{code}?t={targetKind}&id={targetId}&u={ownerHandle}`. */
export type ShareResponseWire = { shareId: string; inviteCode: string; url: string; channel: ShareChannelWire };

// ---------- contacts matching ----------

/** POST v1/tenant/contacts/salt → single use, 10 minutes. */
export type ContactSaltWire = { saltId: string; salt: string; prefixLength: number; maxHashes: number; expiresAt: string };

/**
 * POST v1/tenant/contacts/match `{ saltId, hashes: [{ p, h }] }` (1–1000) → the people found
 * (self, blocked and invisible cards removed). 404 `contact_salt_not_found`, 400 `hashes_out_of_range`
 * / `hash_invalid`, 429 `too_many_attempts`.
 */
export type ContactMatchRequestWire = { saltId: string; hashes: { p: string; h: string }[] };
export type ContactMatchResponseWire = { matches: PersonCardWire[] };
