import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import type { Look } from '@/api/contracts/looks';
import { fromSource } from '@/api/dataSource';
import { toLookAsync, toLooks, type LookWire } from '@/api/wire/wardrobe';
import { ApiError } from '@/api/errors';
import { clone, fixtureDb } from '@/fixtures/db';

/** Query keys of the looks feature (E3). */
export const lookKeys = {
  looks: ['tenant', 'look'] as const,
  look: (id: string) => ['tenant', 'look', id] as const,
};

/** 14 Looklar — the lookbook; favourite / occasion filters run on the device. */
export function useLooks() {
  return useQuery({
    queryKey: lookKeys.looks,
    queryFn: () =>
      fromSource<Look[]>(
        'wardrobe',
        () => clone(fixtureDb.looks),
        // GET v1/tenant/look → LookDto[], newest first (slots are ids; joined with the wardrobe / catalogue).
        async () => toLooks(await apiRequest<LookWire[]>('v1/tenant/look')),
      ),
  });
}

export function useLook(id: string | null | undefined) {
  return useQuery({
    queryKey: lookKeys.look(id ?? 'none'),
    enabled: Boolean(id),
    queryFn: () =>
      fromSource<Look>(
        'wardrobe',
        () => {
          const look = fixtureDb.looks.find((l) => l.id === id);
          // Same shape as the server's answer for an unknown look: no retry, the screen shows the error state.
          if (!look) throw new ApiError('http', 404, null);
          return clone(look);
        },
        async () => toLookAsync(await apiRequest<LookWire>(`v1/tenant/look/${id}`)),
      ),
  });
}
