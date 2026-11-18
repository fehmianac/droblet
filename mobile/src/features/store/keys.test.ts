import { planKeys } from '@/features/today/keys';

import { storeKeys } from './queries';

const isPrefix = (prefix: readonly unknown[], key: readonly unknown[]) => prefix.every((part, i) => key[i] === part);

describe('weekly edit query keys', () => {
  it('the Keşfet cover (summary) and the 08 detail never share a key or a prefix', () => {
    // Regression: both used ['content','edit','current'] — each screen crashed on the other's cached data,
    // and the 08 updaters (`setQueriesData(planKeys.edits)`) rewrote the Keşfet cover as a detail.
    for (const id of ['current', 'edit_2026-11-16']) {
      expect(storeKeys.edit).not.toEqual(planKeys.edit(id));
    }
    expect(isPrefix(planKeys.edits, storeKeys.edit)).toBe(false);
    expect(isPrefix(storeKeys.edit, planKeys.edit('current'))).toBe(false);
  });
});
