import { useEffect, useRef, type ReactNode } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

/** Canvas 13c D — the heart grows to 125 % and springs back when it fills. Off with reduce motion (`enabled` false). */
export function HeartPop({ active, enabled, children }: { active: boolean; enabled: boolean; children: ReactNode }) {
  const scale = useSharedValue(1);
  const was = useRef(active);
  useEffect(() => {
    if (active && !was.current && enabled) {
      scale.set(withSequence(withTiming(1.25, { duration: 110 }), withSpring(1, { damping: 9, stiffness: 260 })));
    }
    was.current = active;
  }, [active, enabled, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
