import { useMutation, type InfiniteData, type QueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type {
  AcceptInviteRequest,
  BlockRequest,
  FeedPage,
  FollowRequest,
  PersonProfile,
  PersonSuggestion,
  RateLookRequest,
  ReportReason,
  ReportRequest,
  SaveLookRequest,
} from '@/api/contracts/social';
import { fromSource } from '@/api/dataSource';
import { socialFixtures } from '@/fixtures/social';
import { newClientMutation } from '@/sync/clientMutation';
import { TENANT_WRITE_SCOPE } from '@/sync/queryKeys';

import { applyRating, updateFeedLooks } from './feedMath';
import { socialKeys } from './queries';

export const socialMutationKeys = {
  rateLook: ['tenant', 'social', 'look', 'rate'] as const,
  saveLook: ['tenant', 'social', 'look', 'save'] as const,
  follow: ['tenant', 'social', 'follow', 'set'] as const,
  report: ['tenant', 'social', 'person', 'report'] as const,
  block: ['tenant', 'social', 'person', 'block'] as const,
  acceptInvite: ['tenant', 'invite', 'accept'] as const,
};

type Feed = InfiniteData<FeedPage>;

/** Registers the function + optimistic update of every queued E9 write (see `sync/mutationFns`). */
export function registerSocialMutations(client: QueryClient): void {
  client.setMutationDefaults(socialMutationKeys.rateLook, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: RateLookRequest) =>
      fromSource(
        'social',
        () => socialFixtures.rate(vars.lookId, vars.score),
        () =>
          apiRequest<void>(`v1/tenant/people/${vars.handle}/look/${vars.lookId}/rating`, {
            method: 'PUT',
            body: { score: vars.score, clientMutationId: vars.clientMutationId },
          }),
      ),
    onMutate: async (vars: RateLookRequest) => {
      await client.cancelQueries({ queryKey: socialKeys.feed });
      client.setQueryData<Feed>(socialKeys.feed, (prev) =>
        updateFeedLooks(prev, (l) => l.lookId === vars.lookId, (l) => ({ ...l, ...applyRating(l, vars.score) })),
      );
    },
    onError: () => void client.invalidateQueries({ queryKey: socialKeys.feed }),
  });

  client.setMutationDefaults(socialMutationKeys.saveLook, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: SaveLookRequest) =>
      fromSource(
        'social',
        () => socialFixtures.save(vars.lookId, vars.saved),
        () =>
          apiRequest<void>(`v1/tenant/people/${vars.handle}/look/${vars.lookId}/save`, {
            method: 'PUT',
            body: { saved: vars.saved, clientMutationId: vars.clientMutationId },
          }),
      ),
    onMutate: async (vars: SaveLookRequest) => {
      await client.cancelQueries({ queryKey: socialKeys.feed });
      client.setQueryData<Feed>(socialKeys.feed, (prev) =>
        updateFeedLooks(prev, (l) => l.lookId === vars.lookId, (l) => ({ ...l, saved: vars.saved })),
      );
    },
    onError: () => void client.invalidateQueries({ queryKey: socialKeys.feed }),
  });

  client.setMutationDefaults(socialMutationKeys.follow, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: FollowRequest) =>
      fromSource(
        'social',
        () => socialFixtures.follow(vars.handle, vars.follow),
        () =>
          apiRequest<void>(`v1/tenant/follow/${vars.handle}`, {
            method: vars.follow ? 'POST' : 'DELETE',
            body: vars.follow ? { clientMutationId: vars.clientMutationId } : undefined,
          }),
      ),
    onMutate: async (vars: FollowRequest) => {
      await client.cancelQueries({ queryKey: socialKeys.root });
      const setFollowing = <T extends { isFollowing: boolean }>(value: T): T => ({ ...value, isFollowing: vars.follow });
      client.setQueryData<PersonProfile | null>(socialKeys.person(vars.handle), (prev) => (prev ? setFollowing(prev) : prev));
      client.setQueryData<Feed>(socialKeys.feed, (prev) =>
        updateFeedLooks(prev, (l) => l.author.handle === vars.handle, (l) => ({ ...l, author: setFollowing(l.author) })),
      );
      const inLists = (prev: PersonSuggestion[] | undefined) => prev?.map((p) => (p.handle === vars.handle ? setFollowing(p) : p));
      client.setQueryData<PersonSuggestion[]>(socialKeys.suggested, inLists);
      client.setQueriesData<PersonSuggestion[]>({ queryKey: ['tenant', 'social', 'search'] }, inLists);
    },
    onError: () => void client.invalidateQueries({ queryKey: socialKeys.root }),
  });

  client.setMutationDefaults(socialMutationKeys.report, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: ReportRequest) =>
      fromSource(
        'social',
        () => undefined,
        () =>
          apiRequest<void>(`v1/tenant/people/${vars.handle}/report`, {
            method: 'POST',
            body: { reason: vars.reason, clientMutationId: vars.clientMutationId },
          }),
      ),
  });

  client.setMutationDefaults(socialMutationKeys.block, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: BlockRequest) =>
      fromSource(
        'social',
        () => socialFixtures.block(vars.handle),
        () =>
          apiRequest<void>(`v1/tenant/people/${vars.handle}/block`, {
            method: 'POST',
            body: { clientMutationId: vars.clientMutationId },
          }),
      ),
    onMutate: async (vars: BlockRequest) => {
      // The blocked person's content disappears at once, everywhere it is cached.
      await client.cancelQueries({ queryKey: socialKeys.root });
      client.removeQueries({ queryKey: socialKeys.person(vars.handle) });
      client.setQueryData<Feed>(socialKeys.feed, (prev) =>
        prev
          ? {
              ...prev,
              pages: prev.pages.map((page) => ({
                ...page,
                stories: page.stories.filter((s) => s.handle !== vars.handle),
                items: page.items.filter((l) => l.author.handle !== vars.handle),
              })),
            }
          : prev,
      );
      const without = (prev: PersonSuggestion[] | undefined) => prev?.filter((p) => p.handle !== vars.handle);
      client.setQueryData<PersonSuggestion[]>(socialKeys.suggested, without);
      client.setQueriesData<PersonSuggestion[]>({ queryKey: ['tenant', 'social', 'search'] }, without);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: socialKeys.root }),
  });

  client.setMutationDefaults(socialMutationKeys.acceptInvite, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: AcceptInviteRequest) =>
      fromSource('social', () => undefined, () => apiRequest<void>('v1/tenant/invite/accept', { method: 'POST', body: vars })),
  });
}

// ---------- Hooks ----------

const id = () => newClientMutation().clientMutationId;

export function useRateLook() {
  const m = useMutation<void, unknown, RateLookRequest>({ mutationKey: socialMutationKeys.rateLook });
  return (handle: string, lookId: string, score: number) => m.mutate({ handle, lookId, score, clientMutationId: id() });
}

export function useSaveLook() {
  const m = useMutation<void, unknown, SaveLookRequest>({ mutationKey: socialMutationKeys.saveLook });
  return (handle: string, lookId: string, saved: boolean) => m.mutate({ handle, lookId, saved, clientMutationId: id() });
}

export function useFollow() {
  const m = useMutation<void, unknown, FollowRequest>({ mutationKey: socialMutationKeys.follow });
  return (handle: string, follow: boolean) => m.mutate({ handle, follow, clientMutationId: id() });
}

export function useReportPerson() {
  const m = useMutation<void, unknown, ReportRequest>({ mutationKey: socialMutationKeys.report });
  return (handle: string, reason: ReportReason) => m.mutate({ handle, reason, clientMutationId: id() });
}

export function useBlockPerson() {
  const m = useMutation<void, unknown, BlockRequest>({ mutationKey: socialMutationKeys.block });
  return (handle: string) => m.mutate({ handle, clientMutationId: id() });
}

export function useAcceptInvite() {
  const m = useMutation<void, unknown, AcceptInviteRequest>({ mutationKey: socialMutationKeys.acceptInvite });
  return (code: string) => m.mutate({ code, clientMutationId: id() });
}
