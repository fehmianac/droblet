import { useEffect } from 'react';

import { track } from '@/analytics/track';

import { inviteStore } from './inviteStore';
import { useAcceptInvite } from './mutations';

/**
 * Applies a pending invite code once a user is signed in (right after sign-up, or immediately when
 * a signed-in user opens an invite link). The write goes through the queue, so it also works offline.
 */
export function InviteHost({ userId }: { userId: string | null }) {
  const accept = useAcceptInvite();

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const apply = () => {
      void inviteStore.take().then((code) => {
        if (!code || !active) return;
        accept(code);
        track('invite_install', { via: 'link' });
      });
    };
    apply();
    const unsubscribe = inviteStore.subscribe(apply);
    return () => {
      active = false;
      unsubscribe();
    };
    // `accept` is a new function every render; the effect only depends on who is signed in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return null;
}
