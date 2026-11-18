import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';

import { useReduceMotion } from '@/hooks/useReduceMotion';

/** Sand placeholder box with a soft pulse (static when reduce-motion is on). Loading = skeleton, never a spinner. */
export function Skeleton({ className }: { className?: string }) {
  const reduceMotion = useReduceMotion();
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.55, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion]);

  return (
    <Animated.View style={{ opacity }} accessible={false} importantForAccessibility="no-hide-descendants">
      <View className={`bg-sand ${className ?? ''}`} />
    </Animated.View>
  );
}
