import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import { PEOPLE_SEARCH_MIN, type FeedLook, type FollowRequestDirection, type FollowRequestEntry } from '@/api/contracts/social';
import { fromSource, queryString } from '@/api/dataSource';
import { isGone } from '@/api/errors';
import {
  toFeedLook,
  toFeedPage,
  toFollowRequest,
  toInviteLink,
  toItemTile,
  toLookTile,
  toPersonProfile,
  toPersonSuggestion,
  toPersonTrip,
  type FeedPageWire,
  type FollowRequestWire,
  type InviteLinkWire,
  type PersonCardWire,
  type PersonItemWire,
  type PersonProfileWire,
  type PersonTripWire,
  type SocialLookWire,
} from '@/api/wire/social';
import { socialFixtures } from '@/fixtures/social';

/**
 * Query keys for E9. Other people's data lives under its own keys inside this user's cache and is
 * replaced by `null` as soon as the server refuses the read (hidden / blocked / gone → 404).
 */
export const socialKeys = {
  root: ['tenant', 'social'] as const,
  feed: ['tenant', 'social', 'feed'] as const,
  person: (handle: string) => ['tenant', 'social', 'person', handle] as const,
  personLooks: (handle: string) => ['tenant', 'social', 'person', handle, 'look'] as const,
  personItems: (handle: string) => ['tenant', 'social', 'person', handle, 'item'] as const,
  personTrips: (handle: string) => ['tenant', 'social', 'person', handle, 'trip'] as const,
  search: (q: string) => ['tenant', 'social', 'search', q] as const,
  suggested: ['tenant', 'social', 'suggested'] as const,
  savedLooks: ['tenant', 'social', 'saved-look'] as const,
  followers: ['tenant', 'social', 'follower'] as const,
  following: ['tenant', 'social', 'following'] as const,
  blocked: ['tenant', 'social', 'block'] as const,
  followRequests: ['tenant', 'social', 'follow-request'] as const,
  followRequestList: (direction: FollowRequestDirection) => ['tenant', 'social', 'follow-request', direction] as const,
  inviteLink: ['tenant', 'invite', 'link'] as const,
};

/** Resolves to `null` when the server answers 404 — "not visible to you" and "does not exist" look the same. */
async function orHidden<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (e) {
    if (isGone(e)) return null;
    throw e;
  }
}

/** Path segment of a handle (the leading `@` is not part of it). */
export const handlePath = (handle: string) => encodeURIComponent(handle.replace(/^@/, ''));

const people = async (path: string) => (await apiRequest<PersonCardWire[]>(path)).map(toPersonSuggestion);

/**
 * 25 — `GET v1/tenant/feed?pageToken=`: looks of the people this user follows, newest first, 20 per
 * page. The story rings of the first page are derived from its authors (no backend story concept).
 */
export function useFeed() {
  return useInfiniteQuery({
    queryKey: socialKeys.feed,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fromSource(
        'social',
        () => socialFixtures.feed(pageParam),
        async () => toFeedPage(await apiRequest<FeedPageWire>(`v1/tenant/feed${queryString({ pageToken: pageParam })}`), pageParam === null),
      ),
    getNextPageParam: (last) => last.nextPageToken,
  });
}

/** `GET v1/tenant/saved-look` — looks this user saved, most recently saved first (hidden ones are omitted). */
export function useSavedLooks(enabled = true) {
  return useQuery({
    queryKey: socialKeys.savedLooks,
    enabled,
    queryFn: () =>
      fromSource<FeedLook[]>(
        'social',
        () => socialFixtures.savedLooks(),
        async () => (await apiRequest<SocialLookWire[]>('v1/tenant/saved-look')).map((l) => toFeedLook(l, false)),
      ),
  });
}

/** 26 — `GET v1/tenant/people/{handle}`. `null` = not found / private / blocked (404). */
export function usePerson(handle: string) {
  return useQuery({
    queryKey: socialKeys.person(handle),
    queryFn: () =>
      orHidden(
        fromSource(
          'social',
          () => socialFixtures.profile(handle),
          async () => toPersonProfile(await apiRequest<PersonProfileWire>(`v1/tenant/people/${handlePath(handle)}`)),
        ),
      ),
  });
}

/** 26 tabs — each resolves to `null` when the closet is hidden from this viewer (404). */
export function usePersonLooks(handle: string, enabled: boolean) {
  return useQuery({
    queryKey: socialKeys.personLooks(handle),
    enabled,
    queryFn: () =>
      orHidden(
        fromSource(
          'social',
          () => socialFixtures.looks(handle),
          async () => (await apiRequest<SocialLookWire[]>(`v1/tenant/people/${handlePath(handle)}/look`)).map(toLookTile),
        ),
      ),
  });
}

export function usePersonItems(handle: string, enabled: boolean) {
  return useQuery({
    queryKey: socialKeys.personItems(handle),
    enabled,
    queryFn: () =>
      orHidden(
        fromSource(
          'social',
          () => socialFixtures.items(handle),
          async () => (await apiRequest<PersonItemWire[]>(`v1/tenant/people/${handlePath(handle)}/item`)).map(toItemTile),
        ),
      ),
  });
}

/** Trips stay owner-only on the server (open decision A-6): for anyone else this is 404 → `null`. */
export function usePersonTrips(handle: string, enabled: boolean) {
  return useQuery({
    queryKey: socialKeys.personTrips(handle),
    enabled,
    queryFn: () =>
      orHidden(
        fromSource(
          'social',
          () => socialFixtures.trips(handle),
          async () => (await apiRequest<PersonTripWire[]>(`v1/tenant/people/${handlePath(handle)}/trip`)).map(toPersonTrip),
        ),
      ),
  });
}

/** 27 — `GET v1/tenant/people?q=`: @handle prefix search. The server needs at least 2 characters. */
export function usePeopleSearch(q: string) {
  const needle = q.trim().replace(/^@/, '');
  return useQuery({
    queryKey: socialKeys.search(needle),
    enabled: needle.length >= PEOPLE_SEARCH_MIN,
    queryFn: () => fromSource('social', () => socialFixtures.search(needle), () => people(`v1/tenant/people${queryString({ q: needle })}`)),
  });
}

/** 27 — "Sana benzeyen dolaplar": public profiles not followed yet, by style match %. */
export function useSuggestedPeople() {
  return useQuery({
    queryKey: socialKeys.suggested,
    queryFn: () => fromSource('social', socialFixtures.suggested, () => people('v1/tenant/people/suggested')),
  });
}

/** `GET v1/tenant/follower` — people following this user. */
export function useFollowers(enabled = true) {
  return useQuery({
    queryKey: socialKeys.followers,
    enabled,
    queryFn: () => fromSource('social', () => socialFixtures.followers(), () => people('v1/tenant/follower')),
  });
}

/** `GET v1/tenant/following` — people this user follows. */
export function useFollowing(enabled = true) {
  return useQuery({
    queryKey: socialKeys.following,
    enabled,
    queryFn: () => fromSource('social', () => socialFixtures.following(), () => people('v1/tenant/following')),
  });
}

/** `GET v1/tenant/block` — accounts this user blocked (handle + name only). */
export function useBlockedPeople(enabled = true) {
  return useQuery({
    queryKey: socialKeys.blocked,
    enabled,
    queryFn: () => fromSource('social', () => socialFixtures.blocked(), () => people('v1/tenant/block')),
  });
}

/** `GET v1/tenant/invite/link` — the user's invite link + code; every shared link carries the code. */
export function useInviteLink() {
  return useQuery({
    queryKey: socialKeys.inviteLink,
    staleTime: 24 * 60 * 60_000,
    queryFn: () =>
      fromSource('social', socialFixtures.inviteLink, async () => toInviteLink(await apiRequest<InviteLinkWire>('v1/tenant/invite/link'))),
  });
}

/**
 * `GET v1/tenant/follow-request/incoming` (people asking to follow me — approve / decline) and
 * `/outgoing` (my pending requests — cancel). Newest first.
 */
export function useFollowRequests(direction: FollowRequestDirection, enabled = true) {
  return useQuery({
    queryKey: socialKeys.followRequestList(direction),
    enabled,
    queryFn: () =>
      fromSource<FollowRequestEntry[]>(
        'social',
        () => socialFixtures.followRequests(direction),
        async () => (await apiRequest<FollowRequestWire[]>(`v1/tenant/follow-request/${direction}`)).map(toFollowRequest),
      ),
  });
}

/** Number of people waiting for my approval (badge on Profil / Arkadaşlar); 0 while unknown. */
export function useIncomingRequestCount(enabled = true): number {
  return useFollowRequests('incoming', enabled).data?.length ?? 0;
}
