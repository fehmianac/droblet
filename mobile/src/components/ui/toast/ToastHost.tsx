import { CircleAlert, Check, Heart, Info, type LucideIcon } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReduceMotion } from '@/hooks/useReduceMotion';
import { onInkTones } from '@/theme/tokens';

import { Icon } from '../Icon';
import { Text } from '../Text';
import { hideToast, useToast, type Toast, type ToastIcon } from './store';

const ICONS: Record<ToastIcon, { icon: LucideIcon; filled?: boolean }> = {
  check: { icon: Check },
  heart: { icon: Heart },
  heartFilled: { icon: Heart, filled: true },
  info: { icon: Info },
  alert: { icon: CircleAlert },
};

/** Clears a bottom action bar (12 + 52 + the safe area) or the tab bar, + 12 (canvas 13b "Yerleşim"). */
const ABOVE_BAR = 76;
const FADE_MS = 200;
/** A downward drag this long dismisses. */
const SWIPE_DISMISS_DY = 24;

/**
 * Canvas 13b — the one toast of the app: ink ground, cream text, an icon, at most one action (44-pt target).
 * Mounted once at the root, above the navigator. Slides up 8 pt and fades (reduce motion: fades only);
 * a downward swipe or the action dismisses it, otherwise it goes after its duration.
 */
export function ToastHost() {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [shown, setShown] = useState<Toast | null>(toast);
  if (toast && toast !== shown) setShown(toast);
  const visible = useSharedValue(0);

  useEffect(() => {
    visible.set(withTiming(toast ? 1 : 0, { duration: FADE_MS }));
    if (!toast) return undefined;
    const timer = setTimeout(() => hideToast(toast.id), toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast, visible]);

  const style = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateY: reduceMotion ? 0 : (1 - visible.value) * 8 }],
  }));

  const touchY = useRef<number | null>(null);
  const onTouchStart = (e: GestureResponderEvent) => {
    touchY.current = e.nativeEvent.pageY;
  };
  const onTouchEnd = (e: GestureResponderEvent) => {
    const from = touchY.current;
    touchY.current = null;
    if (from !== null && e.nativeEvent.pageY - from > SWIPE_DISMISS_DY && toast) hideToast(toast.id);
  };

  if (!shown) return null;
  const glyph = ICONS[shown.icon];
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 16, right: 16, bottom: Math.max(insets.bottom, 16) + ABOVE_BAR }}
      testID="toast-layer"
    >
      <Animated.View style={style} pointerEvents={toast ? 'auto' : 'none'}>
        <View
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          className="min-h-[52px] flex-row items-center gap-3 rounded-[14px] bg-ink py-1 pl-4 pr-1 shadow-md"
          accessibilityLiveRegion={shown.tone === 'error' ? 'assertive' : 'polite'}
          testID={toast ? shown.testID : undefined}
        >
          <ToastGlyph icon={glyph.icon} filled={glyph.filled} danger={shown.tone === 'error'} />
          <Text variant="body" tone="cream" className="flex-1 py-2 text-[14px] leading-[19px]" numberOfLines={2} testID="toast-message">
            {shown.message}
          </Text>
          {shown.action ? (
            <Pressable
              onPress={() => {
                const action = shown.action;
                hideToast(shown.id);
                action?.onPress();
              }}
              accessibilityRole="button"
              accessibilityLabel={shown.action.label}
              hitSlop={4}
              className="h-11 justify-center px-3 active:opacity-70"
              testID="toast-action"
            >
              <Text variant="bodyMedium" className="text-[14px]" style={{ color: onInkTones.action }}>
                {shown.action.label}
              </Text>
            </Pressable>
          ) : (
            <View className="w-3" />
          )}
        </View>
      </Animated.View>
    </View>
  );
}

function ToastGlyph({ icon, filled, danger }: { icon: LucideIcon; filled?: boolean; danger: boolean }) {
  if (danger) {
    // Canvas 13b error glyph: a light clay on ink (the palette's danger is too dark on the ink ground).
    const Glyph = icon;
    return <Glyph size={18} color={onInkTones.danger} strokeWidth={1.6} />;
  }
  return <Icon icon={icon} size={18} tone="cream" filled={filled} />;
}
