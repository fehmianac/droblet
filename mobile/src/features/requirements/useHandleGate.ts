import { useCallback } from 'react';

import { useMyProfile } from '@/features/account/queries';

import { requirementsFlow } from './store';

/**
 * The @handle gate of every social action (share a look, copy / share the profile link, invite, follow): with a
 * handle — or while the profile is not known yet (never block on missing data) — the action runs at once; without
 * one the requirements flow opens on its handle step (canvas 11 "Kullanıcı adın gerekiyor") and the action runs
 * after "Hazır", where the user left off.
 *
 *   const withHandle = useHandleGate();
 *   <IconButton onPress={() => withHandle(share, look.name)} />
 */
export function useHandleGate() {
  const profile = useMyProfile();
  const missing = profile.data !== undefined && !profile.data.handle;
  return useCallback(
    (run: () => void, origin?: string | null) => {
      if (!missing) {
        run();
        return;
      }
      requirementsFlow.open({ action: 'social', start: 'steps', only: 'handle', onResume: run, origin: origin ?? null });
    },
    [missing],
  );
}

/** True when the profile is known and has no @handle (the find screen shows its "claim a handle" row). */
export function useHandleMissing(): boolean {
  const profile = useMyProfile();
  return profile.data !== undefined && !profile.data.handle;
}
