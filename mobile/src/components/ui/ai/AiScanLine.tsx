import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { useReduceMotion } from '@/hooks/useReduceMotion';
import { motion, scanTones } from '@/theme/tokens';

/** Halo above and below the line (canvas: ±14 px). */
const HALO = 14;
const LINE = 2;

/**
 * The scanner line over a photo being recognised (12 Parça ekle, canvas `EkleTaniniyor`): a 2 px cream
 * line with a faint halo sweeping top → bottom → top, 2 s per sweep, ease-in-out, on the UI thread.
 * Absolutely fills its parent (which clips: `overflow-hidden`). When `active` turns off the sweep stops
 * and the line fades out (200 ms). Purely decorative: hidden from assistive tech — the status pill
 * announces the state. With reduce-motion nothing is drawn (the pill alone is the reduced state).
 */
export function AiScanLine({ active }: { active: boolean }) {
  const reduceMotion = useReduceMotion();
  const [height, setHeight] = useState(0);
  const position = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion || height === 0) return;
    if (!active) {
      cancelAnimation(position);
      opacity.set(withTiming(0, { duration: motion.scanFadeMs }));
      return;
    }
    position.set(0);
    opacity.set(withTiming(1, { duration: motion.scanFadeMs }));
    position.set(withRepeat(withTiming(1, { duration: motion.scanSweepMs, easing: Easing.inOut(Easing.ease) }), -1, true));
    return () => cancelAnimation(position);
  }, [active, height, opacity, position, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: position.value * height - HALO - LINE / 2 }],
  }));

  const onLayout = (e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height);

  if (reduceMotion) return null;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={onLayout}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      testID={active ? 'scan-line-sweeping' : 'scan-line-idle'}
    >
      {height === 0 ? null : (
        <Animated.View style={[styles.band, style]}>
          <LinearGradient colors={[scanTones.haloClear, scanTones.halo]} style={styles.halo} />
          <View style={styles.line} />
          <LinearGradient colors={[scanTones.halo, scanTones.haloClear]} style={styles.halo} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute', left: 0, right: 0, top: 0 },
  halo: { height: HALO },
  line: {
    height: LINE,
    backgroundColor: scanTones.line,
    shadowColor: scanTones.line,
    shadowOpacity: 0.55,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
});
