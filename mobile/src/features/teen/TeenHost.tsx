import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';

import type { AgeBand, ParentalConsentStatus } from '@/api/contracts/teen';
import { setProductAnalyticsEnabled } from '@/analytics/preference';
import { accountKeys } from '@/features/account/queries';
import { useAppConfig } from '@/api/appConfig';

import { applyTeenState, useTeenState } from './api';
import { teenStore, useTeenRules } from './store';

type Seen = { band: AgeBand; consent: ParentalConsentStatus };
const seenKey = (userId: string) => `droblet.teen.seen.${userId}`;

export type TeenNotice = 'approved' | 'declined' | 'withdrawn' | 'adult';

/**
 * Which one-time notice a change from `before` to `now` deserves (canvas 18): the parent approved, declined or withdrew,
 * or the account turned 18. The first observation on a phone shows nothing.
 */
export function noticeFor(before: Seen | null, now: Seen): TeenNotice | null {
  if (!before) return null;
  if (before.band === 'teen' && now.band === 'adult') return 'adult';
  if (now.band !== 'teen' || before.consent === now.consent) return null;
  if (now.consent === 'approved') return 'approved';
  if (now.consent === 'declined') return 'declined';
  if (now.consent === 'withdrawn') return 'withdrawn';
  return null;
}

/**
 * Keeps the teen rules in step with the server for the signed-in account: `GET v1/config` → `teen`, `GET v1/tenant/teen`
 * (polled while the parent's answer is awaited). For a teen it switches product analytics off on this phone (it stays off
 * after 18 until the user turns it on, canvas 18 · "18 yaşına girdin"), clears the photo caches after a withdrawal, and
 * opens the one-time notices once the user is in the app (`ready`).
 */
export function TeenHost({ userId, ready }: { userId: string; ready: boolean }) {
  const client = useQueryClient();
  const config = useAppConfig();
  const rules = useTeenRules();
  const state = useTeenState({ enabled: true, polling: rules.isTeen && rules.consent === 'pending' });

  useEffect(() => {
    if (config.data) teenStore.setConfig(config.data.teen);
  }, [config.data]);

  useEffect(() => {
    if (state.data) void applyTeenState(null, state.data);
  }, [state.data]);

  useEffect(() => () => teenStore.reset(), []);

  useEffect(() => {
    if (rules.isTeen) void setProductAnalyticsEnabled(false);
  }, [rules.isTeen]);

  const band = state.data?.ageBand ?? null;
  const consent = rules.consent;
  useEffect(() => {
    if (!band) return;
    const now: Seen = { band, consent: band === 'teen' ? consent : 'none' };
    let alive = true;
    void (async () => {
      let before: Seen | null = null;
      try {
        const raw = await AsyncStorage.getItem(seenKey(userId));
        before = raw ? (JSON.parse(raw) as Seen) : null;
      } catch {
        before = null;
      }
      if (!alive) return;
      const notice = noticeFor(before, now);
      // Wait with a notice until the user is in the app; the change is remembered only once it was shown.
      if (notice && !ready) return;
      if (notice === 'withdrawn') {
        void client.invalidateQueries({ queryKey: accountKeys.photos });
        void client.invalidateQueries({ queryKey: accountKeys.palette });
        client.removeQueries({ queryKey: ['tenant', 'tryon'] });
      }
      try {
        await AsyncStorage.setItem(seenKey(userId), JSON.stringify(now));
      } catch {
        // Shown again next time at worst.
      }
      if (notice && alive) router.push({ pathname: '/teen/notice', params: { kind: notice } });
    })();
    return () => {
      alive = false;
    };
  }, [band, consent, ready, userId, client]);

  return null;
}
