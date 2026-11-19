import { useMutation, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { apiRequest } from '@/api/client';
import { toast } from '@/components/ui/toast';
import type {
  AcceptInviteRequest,
  BlockRequest,
  FeedLook,
  FeedPage,
  FollowRequest,
  FollowRequestAnswer,
  FollowRequestEntry,
  FollowState,
  PersonProfile,
  PersonSuggestion,
  RateLookRequest,
  ReportReason,
  RemoveFollowerRequest,
  ReportRequest,
  SaveLookRequest,
} from '@/api/contracts/social';
import { fromSource } from '@/api/dataSource';
import { ApiError } from '@/api/errors';
import { fromReportReason, type FollowResultWire, type RatingWire, type ReportRequestWire } from '@/api/wire/social';
import { socialFixtures } from '@/fixtures/social';
import { useHandleGate } from '@/features/requirements/useHandleGate';
import { newClientMutation } from '@/sync/clientMutation';
import { TENANT_WRITE_SCOPE } from '@/sync/queryKeys';

import { applyRating, updateFeedLooks } from './feedMath';
import { handlePath, socialKeys } from './queries';

export const socialMutationKeys = {
  rateLook: ['tenant', 'social', 'look', 'rate'] as const,
  saveLook: ['tenant', 'social', 'look', 'save'] as const,
  follow: ['tenant', 'social', 'follow', 'set'] as const,
  answerRequest: ['tenant', 'social', 'follow-request', 'answer'] as const,
  removeFollower: ['tenant', 'social', 'follower', 'remove'] as const,
  report: ['tenant', 'social', 'person', 'report'] as const,
  block: ['tenant', 'social', 'person', 'block'] as const,
  unblock: ['tenant', 'social', 'person', 'unblock'] as const,
  acceptInvite: ['tenant', 'invite', 'accept'] as const,
};

type Feed = InfiniteData<FeedPage>;

const lookPath = (handle: string, lookId: string) => `v1/tenant/people/${handlePath(handle)}/look/${encodeURIComponent(lookId)}`;

/**
 * Invite attribution answers that will never change on a retry: the code is unknown (404), the
 * install is already attributed (409), it is the user's own code or the account is too old (422).
 */
export function isFinalInviteAnswer(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 409 || error.status === 422);
}

/** Registers the function + optimistic update of every queued E9 write (see `sync/mutationFns`). */
export function registerSocialMutations(client: QueryClient): void {
  // PUT v1/tenant/people/{handle}/look/{lookId}/rating { score, clientMutationId } → { average, count, myScore }
  client.setMutationDefaults(socialMutationKeys.rateLook, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: RateLookRequest) =>
      fromSource<RatingWire | null>(
        'social',
        () => {
          socialFixtures.rate(vars.lookId, vars.score);
          return null;
        },
        () =>
          apiRequest<RatingWire>(`${lookPath(vars.handle, vars.lookId)}/rating`, {
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
    // The server's summary replaces the optimistic numbers.
    onSuccess: (rating: RatingWire | null, vars: RateLookRequest) => {
      if (!rating) return;
      const summary: Pick<FeedLook, 'myRating' | 'averageRating' | 'ratingCount'> = {
        myRating: rating.myScore,
        averageRating: rating.count > 0 ? rating.average : null,
        ratingCount: rating.count,
      };
      client.setQueryData<Feed>(socialKeys.feed, (prev) => updateFeedLooks(prev, (l) => l.lookId === vars.lookId, (l) => ({ ...l, ...summary })));
    },
    onError: () => void client.invalidateQueries({ queryKey: socialKeys.feed }),
  });

  // PUT (save) / DELETE (remove) v1/tenant/people/{handle}/look/{lookId}/save → 204, no body
  client.setMutationDefaults(socialMutationKeys.saveLook, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: SaveLookRequest) =>
      fromSource(
        'social',
        () => socialFixtures.save(vars.lookId, vars.saved),
        () => apiRequest<void>(`${lookPath(vars.handle, vars.lookId)}/save`, { method: vars.saved ? 'PUT' : 'DELETE' }),
      ),
    onMutate: async (vars: SaveLookRequest) => {
      await client.cancelQueries({ queryKey: socialKeys.feed });
      client.setQueryData<Feed>(socialKeys.feed, (prev) =>
        updateFeedLooks(prev, (l) => l.lookId === vars.lookId, (l) => ({ ...l, saved: vars.saved })),
      );
      // "Kaydı kaldır" on the saved-looks screen: the card leaves at once.
      if (!vars.saved) client.setQueryData<FeedLook[]>(socialKeys.savedLooks, (prev) => prev?.filter((l) => l.lookId !== vars.lookId));
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: socialKeys.savedLooks }),
    onError: () => void client.invalidateQueries({ queryKey: socialKeys.feed }),
  });

  // POST (follow → { state }) / DELETE (unfollow, also cancels a pending request) v1/tenant/follow/{handle}
  client.setMutationDefaults(socialMutationKeys.follow, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: FollowRequest) =>
      fromSource<FollowState>(
        'social',
        () => socialFixtures.follow(vars.handle, vars.follow),
        async () => {
          const path = `v1/tenant/follow/${handlePath(vars.handle)}`;
          if (!vars.follow) {
            await apiRequest<void>(path, { method: 'DELETE' });
            return 'none';
          }
          return (await apiRequest<FollowResultWire>(path, { method: 'POST' })).state;
        },
      ),
    onMutate: async (vars: FollowRequest) => {
      await client.cancelQueries({ queryKey: socialKeys.root });
      // Until the server answers: a public closet is followed at once, anything else is a request.
      const profile = client.getQueryData<PersonProfile | null>(socialKeys.person(vars.handle));
      const guess: FollowState = !vars.follow ? 'none' : profile && profile.closetVisibility !== 'public' ? 'requested' : 'following';
      setFollowState(client, vars.handle, guess);
    },
    // The server's answer (`following` or `requested`) replaces the guess; a new follow changes the
    // feed, the lists and what a followers-only closet shows.
    onSuccess: (state: FollowState, vars: FollowRequest) => {
      setFollowState(client, vars.handle, state);
      void client.invalidateQueries({ queryKey: socialKeys.feed });
      void client.invalidateQueries({ queryKey: socialKeys.following });
      void client.invalidateQueries({ queryKey: socialKeys.followRequests });
      void client.invalidateQueries({ queryKey: socialKeys.person(vars.handle) });
    },
    onError: () => void client.invalidateQueries({ queryKey: socialKeys.root }),
  });

  // POST v1/tenant/follow-request/{handle}/approve · /decline (incoming), DELETE …/{handle} (cancel mine) → 204
  client.setMutationDefaults(socialMutationKeys.answerRequest, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: FollowRequestAnswer) =>
      fromSource(
        'social',
        () => socialFixtures.answerRequest(vars.handle, vars.action),
        async () => {
          const path = `v1/tenant/follow-request/${handlePath(vars.handle)}`;
          try {
            if (vars.action === 'cancel') await apiRequest<void>(path, { method: 'DELETE' });
            else await apiRequest<void>(`${path}/${vars.action}`, { method: 'POST' });
          } catch (e) {
            // 404 = the request is no longer pending (answered elsewhere, cancelled, blocked): nothing left to do.
            if (!(e instanceof ApiError && e.status === 404)) throw e;
          }
        },
      ),
    onMutate: async (vars: FollowRequestAnswer) => {
      const direction = vars.action === 'cancel' ? 'outgoing' : 'incoming';
      await client.cancelQueries({ queryKey: socialKeys.followRequests });
      client.setQueryData<FollowRequestEntry[]>(socialKeys.followRequestList(direction), (prev) =>
        prev?.filter((r) => r.person.handle !== vars.handle),
      );
      if (vars.action === 'cancel') setFollowState(client, vars.handle, 'none');
      else
        client.setQueryData<PersonProfile | null>(socialKeys.person(vars.handle), (prev) =>
          prev ? { ...prev, requestedYou: false, ...(vars.action === 'approve' ? { followsYou: true } : {}) } : prev,
        );
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: socialKeys.followRequests });
      void client.invalidateQueries({ queryKey: socialKeys.followers });
      void client.invalidateQueries({ queryKey: ['tenant', 'profile', 'stats'] });
    },
  });

  // DELETE v1/tenant/follower/{handle} → 204 (idempotent)
  client.setMutationDefaults(socialMutationKeys.removeFollower, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: RemoveFollowerRequest) =>
      fromSource(
        'social',
        () => socialFixtures.removeFollower(vars.handle),
        () => apiRequest<void>(`v1/tenant/follower/${handlePath(vars.handle)}`, { method: 'DELETE' }),
      ),
    onMutate: async (vars: RemoveFollowerRequest) => {
      await client.cancelQueries({ queryKey: socialKeys.followers });
      client.setQueryData<PersonSuggestion[]>(socialKeys.followers, (prev) => prev?.filter((p) => p.handle !== vars.handle));
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: socialKeys.followers });
      void client.invalidateQueries({ queryKey: ['tenant', 'profile', 'stats'] });
    },
  });

  // POST v1/tenant/people/{handle}/report { targetKind, targetId?, reason, note? } → 201 { reportId }
  client.setMutationDefaults(socialMutationKeys.report, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: ReportRequest) =>
      fromSource(
        'social',
        () => undefined,
        async () => {
          const target = vars.target ?? { kind: 'profile' as const };
          const body: ReportRequestWire = { targetKind: target.kind, reason: fromReportReason(vars.reason) };
          if (target.kind !== 'profile') body.targetId = target.id;
          if (vars.note) body.note = vars.note.slice(0, 500);
          await apiRequest<{ reportId: string }>(`v1/tenant/people/${handlePath(vars.handle)}/report`, { method: 'POST', body });
        },
      ),
  });

  // PUT v1/tenant/block/{handle} → 204 (removes follows in both directions)
  client.setMutationDefaults(socialMutationKeys.block, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: BlockRequest) =>
      fromSource(
        'social',
        () => socialFixtures.block(vars.handle),
        () => apiRequest<void>(`v1/tenant/block/${handlePath(vars.handle)}`, { method: 'PUT' }),
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

  // DELETE v1/tenant/block/{handle} → 204 (follows are not restored)
  client.setMutationDefaults(socialMutationKeys.unblock, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: BlockRequest) =>
      fromSource(
        'social',
        () => socialFixtures.unblock(vars.handle),
        () => apiRequest<void>(`v1/tenant/block/${handlePath(vars.handle)}`, { method: 'DELETE' }),
      ),
    onMutate: async (vars: BlockRequest) => {
      await client.cancelQueries({ queryKey: socialKeys.blocked });
      client.setQueryData<PersonSuggestion[]>(socialKeys.blocked, (prev) => prev?.filter((p) => p.handle !== vars.handle));
    },
    onSettled: () => void client.invalidateQueries({ queryKey: socialKeys.root }),
  });

  // POST v1/tenant/invite/attribution { code } → 204
  client.setMutationDefaults(socialMutationKeys.acceptInvite, {
    scope: TENANT_WRITE_SCOPE,
    mutationFn: (vars: AcceptInviteRequest) =>
      fromSource(
        'social',
        () => undefined,
        async () => {
          try {
            await apiRequest<void>('v1/tenant/invite/attribution', { method: 'POST', body: { code: vars.code } });
          } catch (e) {
            // Unknown code, already attributed, own code, window closed: nothing to do and nothing to show.
            if (!isFinalInviteAnswer(e)) throw e;
          }
        },
      ),
  });
}

/** Writes a follow state into every cached place that shows it (profile, feed authors, people lists). */
function setFollowState(client: QueryClient, handle: string, followState: FollowState): void {
  const isFollowing = followState === 'following';
  const apply = <T extends { isFollowing: boolean }>(value: T): T => ({ ...value, isFollowing, followState });
  client.setQueryData<PersonProfile | null>(socialKeys.person(handle), (prev) => (prev ? apply(prev) : prev));
  client.setQueryData<Feed>(socialKeys.feed, (prev) =>
    updateFeedLooks(prev, (l) => l.author.handle === handle, (l) => ({ ...l, author: { ...l.author, isFollowing } })),
  );
  const inLists = (prev: PersonSuggestion[] | undefined) => prev?.map((p) => (p.handle === handle ? apply(p) : p));
  client.setQueryData<PersonSuggestion[]>(socialKeys.suggested, inLists);
  client.setQueryData<PersonSuggestion[]>(socialKeys.followers, inLists);
  client.setQueriesData<PersonSuggestion[]>({ queryKey: ['tenant', 'social', 'search'] }, inLists);
  client.setQueriesData<PersonSuggestion[]>({ queryKey: ['tenant', 'social', 'contacts'] }, inLists);
}

// ---------- Hooks ----------

const id = () => newClientMutation().clientMutationId;

export function useRateLook() {
  const m = useMutation<unknown, unknown, RateLookRequest>({ mutationKey: socialMutationKeys.rateLook });
  return (handle: string, lookId: string, score: number) => m.mutate({ handle, lookId, score, clientMutationId: id() });
}

export function useSaveLook() {
  const { t } = useTranslation();
  const m = useMutation<void, unknown, SaveLookRequest>({ mutationKey: socialMutationKeys.saveLook });
  return (handle: string, lookId: string, saved: boolean) => {
    m.mutate({ handle, lookId, saved, clientMutationId: id() });
    toast.success(t(saved ? 'feedback.savedLooks.added' : 'feedback.savedLooks.removed'), {
      icon: saved ? 'heartFilled' : 'heart',
      action: saved ? { label: t('feedback.see'), onPress: () => router.push('/friends/saved') } : undefined,
      testID: 'toast-saved-look',
    });
  };
}

/**
 * `follow: true` = follow / send a request; `false` = unfollow or cancel the pending request. Following needs an
 * @handle (the other side sees who follows): without one the handle step opens first and the follow is sent after it.
 */
export function useFollow() {
  const { t } = useTranslation();
  const m = useMutation<FollowState, unknown, FollowRequest>({ mutationKey: socialMutationKeys.follow });
  const withHandle = useHandleGate();
  return (handle: string, follow: boolean) => {
    const send = () => {
      m.mutate(
        { handle, follow, clientMutationId: id() },
        {
          // A private account answers "requested": the toast says which one happened.
          onSuccess: (state) => {
            if (follow && state === 'requested') toast.success(t('feedback.follow.requested', { handle }), { testID: 'toast-follow' });
          },
          onError: () => toast.error(t('feedback.follow.failed'), { testID: 'toast-follow-failed' }),
        },
      );
      if (follow) toast.success(t('feedback.follow.following', { handle }), { testID: 'toast-follow' });
      else toast.success(t('feedback.follow.unfollowed', { handle }), { testID: 'toast-follow' });
    };
    if (follow) withHandle(send, `@${handle}`);
    else send();
  };
}

/** Approve / decline a request to follow me, or cancel my own pending request. */
export function useAnswerFollowRequest() {
  const m = useMutation<void, unknown, FollowRequestAnswer>({ mutationKey: socialMutationKeys.answerRequest });
  return (handle: string, action: FollowRequestAnswer['action']) => m.mutate({ handle, action, clientMutationId: id() });
}

export function useRemoveFollower() {
  const m = useMutation<void, unknown, RemoveFollowerRequest>({ mutationKey: socialMutationKeys.removeFollower });
  return (handle: string) => m.mutate({ handle, clientMutationId: id() });
}

/** Reports the profile by default; pass `target` to report one look / item of that person. */
export function useReportPerson() {
  const m = useMutation<void, unknown, ReportRequest>({ mutationKey: socialMutationKeys.report });
  return (handle: string, reason: ReportReason, target?: ReportRequest['target'], note?: string) =>
    m.mutate({ handle, reason, target, note, clientMutationId: id() });
}

export function useBlockPerson() {
  const { t } = useTranslation();
  const m = useMutation<void, unknown, BlockRequest>({ mutationKey: socialMutationKeys.block });
  return (handle: string) => {
    m.mutate({ handle, clientMutationId: id() });
    toast.success(t('feedback.block.done', { handle }), { testID: 'toast-block' });
  };
}

export function useUnblockPerson() {
  const m = useMutation<void, unknown, BlockRequest>({ mutationKey: socialMutationKeys.unblock });
  return (handle: string) => m.mutate({ handle, clientMutationId: id() });
}

export function useAcceptInvite() {
  const m = useMutation<void, unknown, AcceptInviteRequest>({ mutationKey: socialMutationKeys.acceptInvite });
  return (code: string) => m.mutate({ code, clientMutationId: id() });
}
