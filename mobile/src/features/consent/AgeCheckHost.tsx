import { useEffect } from 'react';

import { sessionStore, useSession } from '@/auth/session';

import { readAgeConfirmed } from './age';

/**
 * Sessions stored before the 18+ check carry no `ageConfirmed`: the profile is asked once per app
 * start; an unconfirmed account is then routed to `/age-confirm` by the root guards. New sign-ins set
 * the flag before the session flips (`api/auth.ts`), so this does nothing for them.
 */
export function AgeCheckHost() {
  const session = useSession();
  const unknown = session.status === 'signedIn' && session.user.ageConfirmed === undefined;
  useEffect(() => {
    if (!unknown) return;
    let alive = true;
    void readAgeConfirmed()
      .then((confirmed) => {
        if (alive && confirmed !== undefined) void sessionStore.updateUser({ ageConfirmed: confirmed });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [unknown]);
  return null;
}
