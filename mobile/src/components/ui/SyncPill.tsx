import { useMutationState, useQueryClient, type Mutation } from '@tanstack/react-query';
import { Check, CircleAlert, WifiOff } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/errors';
import { DropLoader } from '@/components/brand/DropLoader';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useIsOnline, usePendingWrites } from '@/sync/network';
import { TENANT_WRITE_SCOPE } from '@/sync/queryKeys';

import { Icon } from './Icon';
import { Text } from './Text';

/** The queue must stay non-empty this long before "Senkronize ediliyor…" shows (quick writes stay silent). */
export const SYNC_PILL_SHOW_DELAY_MS = 600;
/** After the queue empties the pill says "Senkronize edildi" this long, then hides. */
export const SYNC_PILL_HIDE_DELAY_MS = 1200;
const FADE_MS = 200;
/** Canvas `SenkronPill`: y 108 on a 54-pt status bar = the safe area + the 48-pt header + 6. */
const BELOW_HEADER = 54;

export type SyncPillPhase = 'hidden' | 'syncing' | 'synced' | 'offline' | 'error';

/** A queued write that failed for a reason worth retrying (no connection, server trouble) — not a refusal. */
function isRetryableFailure(m: Mutation<unknown, Error, unknown, unknown>): boolean {
  if (m.state.status !== 'error' || m.options.scope?.id !== TENANT_WRITE_SCOPE.id) return false;
  const e = m.state.error;
  return e instanceof ApiError && (e.kind === 'network' || (e.status !== null && e.status >= 500));
}

/**
 * Phase of the sync pill from what the device knows: offline wins (persistent), then failed writes, then a
 * queue that has stayed busy for `SYNC_PILL_SHOW_DELAY_MS` (and "synced" for `SYNC_PILL_HIDE_DELAY_MS`
 * after it empties). Reads only mutations — a pull-to-refresh (a query) never shows it.
 */
export function useSyncPillPhase(): SyncPillPhase {
  const online = useIsOnline();
  const pending = usePendingWrites();
  const failed = useMutationState({ filters: { predicate: isRetryableFailure } }).length;
  const busy = pending > 0;
  // idle → (queue busy) waiting → (600 ms) shown → (queue empty) synced → (1.2 s) idle.
  const [queue, setQueue] = useState<'idle' | 'waiting' | 'shown' | 'synced'>(busy ? 'waiting' : 'idle');
  const [wasBusy, setWasBusy] = useState(busy);
  if (busy !== wasBusy) {
    // Adjusting state to the new queue length during render (no effect round-trip).
    setWasBusy(busy);
    if (busy) setQueue((q) => (q === 'shown' ? 'shown' : 'waiting'));
    else setQueue((q) => (q === 'shown' ? 'synced' : 'idle'));
  }
  useEffect(() => {
    if (queue === 'waiting') {
      const timer = setTimeout(() => setQueue('shown'), SYNC_PILL_SHOW_DELAY_MS);
      return () => clearTimeout(timer);
    }
    if (queue === 'synced') {
      const timer = setTimeout(() => setQueue('idle'), SYNC_PILL_HIDE_DELAY_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [queue]);

  if (!online) return 'offline';
  if (failed > 0) return 'error';
  if (queue === 'shown') return 'syncing';
  if (queue === 'synced') return 'synced';
  return 'hidden';
}

/**
 * Floating sync / offline status (canvas "10 · Yükleme ve senkron" → `SenkronPill`, `SenkronDurumlar`):
 * a paper pill, 1-pt line border, 36 high, overlaid under the header — it never changes the height of
 * anything (absolutely positioned, mounted once at the root). Fades and slides 200 ms; reduce motion
 * fades only. "Tekrar dene" re-sends the writes that failed for lack of a connection or a server error.
 */
export function SyncPill() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const client = useQueryClient();
  const phase = useSyncPillPhase();
  // Keep the last visible text while fading out.
  const [shown, setShown] = useState<Exclude<SyncPillPhase, 'hidden'> | null>(null);
  if (phase !== 'hidden' && phase !== shown) setShown(phase);
  const visible = useSharedValue(0);

  useEffect(() => {
    visible.set(withTiming(phase === 'hidden' ? 0 : 1, { duration: FADE_MS }));
  }, [phase, visible]);

  const style = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateY: reduceMotion ? 0 : (1 - visible.value) * -8 }],
  }));

  const retry = () => {
    client
      .getMutationCache()
      .findAll({ predicate: isRetryableFailure })
      .forEach((m) => void m.execute(m.state.variables).catch(() => undefined));
  };

  if (!shown) return null;
  const label = t(`states.pill.${shown}`);
  return (
    <View testID="sync-pill-layer" pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: insets.top + BELOW_HEADER, alignItems: 'center' }}>
      <Animated.View
        style={style}
        pointerEvents={phase === 'hidden' ? 'none' : 'box-none'}
        testID="sync-pill"
        accessibilityLiveRegion="polite"
      >
        <View
          accessible={shown !== 'error'}
          accessibilityRole={shown === 'error' ? undefined : 'text'}
          accessibilityLabel={shown === 'error' ? undefined : label}
          className="h-9 flex-row items-center gap-2 rounded-pill border border-line bg-paper pl-3 pr-4 shadow-sm"
        >
          {/* Canvas SenkronPill / SenkronDurumlar: the drop mark only while syncing; a check (accent) once synced,
              wifi-off (muted) offline, an alert (danger) when a write failed. */}
          {shown === 'syncing' ? <DropLoader size="inline" accessibilityLabel={label} /> : null}
          {shown === 'synced' ? <Icon icon={Check} size={16} tone="accent" /> : null}
          {shown === 'offline' ? <Icon icon={WifiOff} size={16} tone="muted" /> : null}
          {shown === 'error' ? <Icon icon={CircleAlert} size={16} tone="danger" /> : null}
          <Text variant="caption" tone={shown === 'error' ? 'danger' : 'ink'} className="text-[12.5px]" numberOfLines={1} testID="sync-pill-label">
            {label}
          </Text>
          {shown === 'error' ? (
            <>
              <Text variant="caption" tone="muted" className="text-[12.5px]" accessible={false}>
                ·
              </Text>
              {/* 44-pt target inside the 36-pt pill (canvas `.rt`: negative margins, padding). */}
              <Pressable
                onPress={retry}
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
                className="-my-1 -ml-1 -mr-2 h-11 justify-center pl-1 pr-2 active:opacity-70"
                testID="sync-pill-retry"
              >
                <Text variant="caption" className="font-sans-medium text-[12.5px] underline">
                  {t('common.retry')}
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}
