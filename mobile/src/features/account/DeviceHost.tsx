import { useEffect } from 'react';

import { registerDevice } from './device';

/**
 * Registers this installation for the signed-in user once per app start (mounted in `AppHosts`,
 * keyed by user). Best effort: offline or a full device list never bothers the user; the next start
 * tries again.
 */
export function DeviceHost() {
  useEffect(() => {
    void registerDevice().catch(() => undefined);
  }, []);
  return null;
}
