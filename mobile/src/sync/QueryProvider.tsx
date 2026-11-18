import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useMemo, type ReactNode } from 'react';

import { CACHE_BUSTER, CACHE_MAX_AGE_MS, createPersister, createQueryClient, dehydrateOptions } from './queryClient';

/**
 * Signed in: a persisted cache + mutation queue keyed by user id; paused writes resume after
 * restore. Signed out: an in-memory client (auth calls only).
 */
export function QueryProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const client = useMemo(() => createQueryClient(), [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const persister = useMemo(() => (userId ? createPersister(userId) : null), [userId]);

  if (!userId || !persister) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{ persister, maxAge: CACHE_MAX_AGE_MS, buster: CACHE_BUSTER, dehydrateOptions }}
      onSuccess={() => void client.resumePausedMutations()}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
