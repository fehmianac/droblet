import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { useReduceMotion } from '@/hooks/useReduceMotion';
import { motion, sheen } from '@/theme/tokens';

/** Band width as a fraction of the surface, and its travel in band-widths (`aiSweep`: -110% → 250%). */
const BAND = 0.45;
const FROM = -1.1;
const TO = 2.5;

/**
 * The light sweep of the AI loading language: a soft paper-coloured band crossing the surface every
 * 1.8 s, linear. Absolutely fills its parent (which should clip: `overflow-hidden`). Renders nothing
 * with reduce-motion — the static placeholder underneath is the reduced state.
 * Defaults are the try-on sweep (45 % band, -110 % → 250 %); the stilist cards use 60 %, -120 % → 220 %.
 */
export function AiShimmer({ band: bandFraction = BAND, from = FROM, to = TO }: { band?: number; from?: number; to?: number } = {}) {
  const reduceMotion = useReduceMotion();
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion || width === 0) return;
    progress.set(0);
    progress.set(withRepeat(withTiming(1, { duration: motion.shimmerMs, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion, width]);

  const band = width * bandFraction;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: band * (from + (to - from) * progress.value) }],
  }));

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View
      style={StyleSheet.absoluteFill}
      className="overflow-hidden"
      pointerEvents="none"
      onLayout={onLayout}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {reduceMotion || width === 0 ? null : (
        <Animated.View style={[styles.band, { width: band }, style]}>
          <LinearGradient
            colors={[sheen.clear, sheen.peak, sheen.clear]}
            start={{ x: 0, y: 0.4 }}
            end={{ x: 1, y: 0.6 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

type PlaceholderProps = {
  /** Size, aspect ratio and radius, e.g. `aspect-[4/5] w-full rounded-image-lg`. */
  className?: string;
  /** Centre content (an icon, the drop, progress lines). */
  children?: ReactNode;
  accessibilityLabel?: string;
};

/**
 * Image slot that is still being generated: sand box + shimmer. Replaces spinners everywhere an AI
 * image will appear (try-on previews, processed item photos).
 */
export function AiShimmerImage({ className, children, accessibilityLabel }: PlaceholderProps) {
  return (
    <View
      className={`items-center justify-center overflow-hidden bg-sand ${className ?? ''}`}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: true }}
    >
      <AiShimmer />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ band: { position: 'absolute', top: 0, bottom: 0, left: 0 } });
