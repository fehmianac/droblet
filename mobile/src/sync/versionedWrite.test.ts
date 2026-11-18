import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/errors';

import { conflictStore } from './conflicts';
import { registerVersionedWrite } from './versionedWrite';

type Rec = { language: string; baseVersion: number };
type Vars = { language: string; baseVersion: number; clientMutationId: string };

const conflict = (current: Rec) => new ApiError('http', 409, { ...current } as never);

function setup(rebaseOnConflict: boolean, send: jest.Mock) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  registerVersionedWrite<Vars, Rec>(client, {
    mutationKey: ['t', 'lang'],
    queryKey: ['t', 'profile'],
    send,
    optimistic: (prev, vars) => (prev ? { ...prev, language: vars.language } : prev),
    rebaseOnConflict,
  });
  client.setQueryData<Rec>(['t', 'profile'], { language: 'tr', baseVersion: 1 });
  const run = (vars: Vars) => client.getMutationCache().build(client, { mutationKey: ['t', 'lang'] }).execute(vars).catch(() => undefined);
  return { client, run };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => conflictStore.get().forEach((c) => conflictStore.resolve(c.id)));

describe('versioned write', () => {
  it('a device-owned field (language) is re-sent once on the current version instead of asking', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(conflict({ language: 'tr', baseVersion: 4 }))
      .mockResolvedValueOnce({ language: 'en', baseVersion: 5 });
    const { client, run } = setup(true, send);
    await run({ language: 'en', baseVersion: 1, clientMutationId: 'm1' });
    for (let i = 0; i < 5; i += 1) await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect((send.mock.calls[1] as [Vars])[0]).toMatchObject({ language: 'en', baseVersion: 4 });
    expect(conflictStore.get()).toHaveLength(0);
    expect(client.getQueryData(['t', 'profile'])).toEqual({ language: 'en', baseVersion: 5 });
  });

  it('a second conflict after the re-send, and any conflict without the option, asks the user', async () => {
    const twice = jest.fn().mockRejectedValue(conflict({ language: 'tr', baseVersion: 6 }));
    await setup(true, twice).run({ language: 'en', baseVersion: 1, clientMutationId: 'm2' });
    for (let i = 0; i < 5; i += 1) await flush();
    expect(twice).toHaveBeenCalledTimes(2);
    expect(conflictStore.get()).toHaveLength(1);

    conflictStore.get().forEach((c) => conflictStore.resolve(c.id));
    const once = jest.fn().mockRejectedValue(conflict({ language: 'tr', baseVersion: 6 }));
    await setup(false, once).run({ language: 'en', baseVersion: 1, clientMutationId: 'm3' });
    for (let i = 0; i < 5; i += 1) await flush();
    expect(once).toHaveBeenCalledTimes(1);
    expect(conflictStore.get()).toHaveLength(1);
  });
});
