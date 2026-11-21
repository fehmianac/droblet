import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { DATA_SOURCE } from '@/api/dataSource';
import { setBodyProfileFixture, useStyleProfile } from '@/api/profile';
import { applyAccountPersona } from '@/fixtures/account';
import { fixturePersona, resetFixtureDb } from '@/fixtures/db';
import { SHOWCASE } from '@/fixtures/showcase';
import { queryKeys } from '@/sync/queryKeys';

import { appSegment } from './catalog';
import { segmentStore, useSegment } from './store';

/**
 * Keeps `useSegment()` in step with the signed-in user's style profile (keyed by user: a new account starts
 * from women until its profile says otherwise). When the segment changes — onboarding 03a or
 * Profil › Stil profili — the server-side segment content (weekly edit, Keşfet collections, Bugün) is
 * refetched; library and catalogue queries carry the segment in their keys and follow by themselves.
 */
export function SegmentHost() {
  const client = useQueryClient();
  const profile = useStyleProfile();
  const saved = profile.data ? appSegment(profile.data.segment) : null;
  const segment = useSegment();
  const previous = useRef<string | null>(null);

  // Sign-out / another account (the host is keyed by user): back to the default.
  useEffect(() => () => segmentStore.reset(), []);

  useEffect(() => {
    if (saved) segmentStore.set(saved);
  }, [saved]);

  // Showcase build (fixtures, never Jest or the API): a men's style profile shows the men's showcase account.
  useEffect(() => {
    if (!saved || !SHOWCASE || DATA_SOURCE.wardrobe !== 'fixtures' || fixturePersona() === saved) return;
    resetFixtureDb({ persona: saved });
    applyAccountPersona(saved);
    // Emre has height and size but no body type yet: Profil › "Profilini tamamla" opens the men's 11e step.
    setBodyProfileFixture(
      saved === 'men'
        ? { heightCm: 180, weightKg: null, size: 'L', bodyType: null, baseVersion: 1 }
        : { heightCm: 168, weightKg: null, size: 'M', bodyType: 'hourglass', baseVersion: 1 },
    );
    // Drop every cached answer (not just mark it stale): screens mounted later must not show the women account.
    void client.resetQueries();
  }, [client, saved]);

  useEffect(() => {
    if (previous.current !== null && previous.current !== segment) {
      void client.invalidateQueries({ queryKey: ['content'] });
      void client.invalidateQueries({ queryKey: queryKeys.today });
    }
    previous.current = segment;
  }, [client, segment]);

  return null;
}
