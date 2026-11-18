import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type {
  FeedPage,
  InviteLink,
  PersonProfile,
  PersonSuggestion,
  PersonTile,
  PersonTrip,
} from '@/api/contracts/social';
import { fromSource, queryString } from '@/api/dataSource';
import { isGone } from '@/api/errors';
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

/** 25 — looks of the people this user follows (+ story rings on the first page). */
export function useFeed() {
  return useInfiniteQuery({
    queryKey: socialKeys.feed,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fromSource('social', () => socialFixtures.feed(pageParam), () => apiRequest<FeedPage>(`v1/tenant/feed${queryString({ pageToken: pageParam })}`)),
    getNextPageParam: (last) => last.nextPageToken,
  });
}

/** 26 — profile card. `null` = not found / blocked. */
export function usePerson(handle: string) {
  return useQuery({
    queryKey: socialKeys.person(handle),
    queryFn: () =>
      orHidden(fromSource('social', () => socialFixtures.profile(handle), () => apiRequest<PersonProfile>(`v1/tenant/people/${handle}`))),
  });
}

/** 26 tabs — each resolves to `null` when the closet is hidden from this viewer. */
export function usePersonLooks(handle: string, enabled: boolean) {
  return useQuery({
    queryKey: socialKeys.personLooks(handle),
    enabled,
    queryFn: () =>
      orHidden(fromSource('social', () => socialFixtures.looks(handle), () => apiRequest<PersonTile[]>(`v1/tenant/people/${handle}/look`))),
  });
}

export function usePersonItems(handle: string, enabled: boolean) {
  return useQuery({
    queryKey: socialKeys.personItems(handle),
    enabled,
    queryFn: () =>
      orHidden(fromSource('social', () => socialFixtures.items(handle), () => apiRequest<PersonTile[]>(`v1/tenant/people/${handle}/item`))),
  });
}

export function usePersonTrips(handle: string, enabled: boolean) {
  return useQuery({
    queryKey: socialKeys.personTrips(handle),
    enabled,
    queryFn: () =>
      orHidden(fromSource('social', () => socialFixtures.trips(handle), () => apiRequest<PersonTrip[]>(`v1/tenant/people/${handle}/trip`))),
  });
}

/** 27 — @username prefix search. Disabled for an empty query. */
export function usePeopleSearch(q: string) {
  const needle = q.trim().replace(/^@/, '');
  return useQuery({
    queryKey: socialKeys.search(needle),
    enabled: needle.length > 0,
    queryFn: () =>
      fromSource('social', () => socialFixtures.search(needle), () => apiRequest<PersonSuggestion[]>(`v1/tenant/people${queryString({ q: needle })}`)),
  });
}

/** 27 — "Sana benzeyen dolaplar" with style match %. */
export function useSuggestedPeople() {
  return useQuery({
    queryKey: socialKeys.suggested,
    queryFn: () => fromSource('social', socialFixtures.suggested, () => apiRequest<PersonSuggestion[]>('v1/tenant/people/suggested')),
  });
}

/** The user's invite link + code; every shared link carries the code. */
export function useInviteLink() {
  return useQuery({
    queryKey: socialKeys.inviteLink,
    staleTime: 24 * 60 * 60_000,
    queryFn: () => fromSource('social', socialFixtures.inviteLink, () => apiRequest<InviteLink>('v1/tenant/invite/link')),
  });
}
